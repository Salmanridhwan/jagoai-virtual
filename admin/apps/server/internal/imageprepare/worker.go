package imageprepare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/openpost/backend/internal/capabilities"
)

const workerArgument = "--openpost-image-prepare-worker"
const maxWorkerInput = 50 * 1024 * 1024
const maxWorkerOutput = 32 * 1024 * 1024

var fittingSlots = make(chan struct{}, 2)

type workerResult struct {
	MIME       string            `json:"mime,omitempty"`
	Width      int               `json:"width,omitempty"`
	Height     int               `json:"height,omitempty"`
	Size       int               `json:"size,omitempty"`
	Thumbnails []workerThumbnail `json:"thumbnails,omitempty"`
	Error      string            `json:"error,omitempty"`
}

// Prepare runs bounded image processing in a child of the current executable. The
// caller's deadline terminates decoding, resizing and encoding, including code
// that cannot observe a Go context. No provider credentials cross the pipe.
func Prepare(ctx context.Context, input []byte, limits capabilities.MediaConstraint) (*Prepared, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if len(input) > maxWorkerInput {
		return nil, ErrCannotFit
	}
	select {
	case fittingSlots <- struct{}{}:
		defer func() { <-fittingSlots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	var header bytes.Buffer
	if err := writeWorkerHeader(&header, limits); err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, executable, workerArgument)
	command.Env = []string{"GOMEMLIMIT=512MiB", "GOMAXPROCS=2"}
	command.Stdin = io.MultiReader(&header, bytes.NewReader(input))
	output := &workerBuffer{remaining: maxWorkerOutput + 2*1024*1024 + 4096}
	command.Stdout = output
	command.Stderr = io.Discard
	command.WaitDelay = time.Second
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrCannotFit
	}
	reader := bytes.NewReader(output.Bytes())
	var result workerResult
	if err := readWorkerHeader(reader, &result); err != nil {
		return nil, ErrCannotFit
	}
	if result.Error == "animated" {
		return nil, ErrAnimated
	}
	if result.Error != "" || result.MIME == "" {
		return nil, ErrCannotFit
	}
	return readPreparedWorkerOutput(reader, result)
}

// RunWorker handles the private stdin/stdout protocol before normal server
// initialization. Entrypoints, including test binaries, call this first so
// child execution exercises the same processing implementation.
func RunWorker(args []string, input io.Reader, output io.Writer) (bool, error) {
	if len(args) != 1 || args[0] != workerArgument {
		return false, nil
	}
	var limits capabilities.MediaConstraint
	if err := readWorkerHeader(input, &limits); err != nil {
		return true, err
	}
	data, err := io.ReadAll(io.LimitReader(input, maxWorkerInput+1))
	if err != nil || len(data) > maxWorkerInput {
		return true, ErrCannotFit
	}
	data, mime, err := fit(context.Background(), data, limits)
	var prepared *Prepared
	if err == nil {
		prepared, err = completePreparation(data, mime)
	}
	if err != nil {
		kind := "cannot_fit"
		if errors.Is(err, ErrAnimated) {
			kind = "animated"
		}
		return true, writeWorkerHeader(output, workerResult{Error: kind})
	}
	return true, writePreparedWorkerOutput(output, prepared)
}

type workerThumbnail struct {
	Size   string
	MIME   string
	Length int
}

func writePreparedWorkerOutput(output io.Writer, prepared *Prepared) error {
	result := workerResult{MIME: prepared.MIME, Size: len(prepared.Content), Width: prepared.Width, Height: prepared.Height}
	for _, thumbnail := range prepared.Thumbnails {
		result.Thumbnails = append(result.Thumbnails, workerThumbnail{Size: thumbnail.Size, MIME: thumbnail.MIME, Length: len(thumbnail.Data)})
	}
	if err := writeWorkerHeader(output, result); err != nil {
		return err
	}
	if _, err := output.Write(prepared.Content); err != nil {
		return err
	}
	for _, thumbnail := range prepared.Thumbnails {
		if _, err := output.Write(thumbnail.Data); err != nil {
			return err
		}
	}
	return nil
}

func readPreparedWorkerOutput(input io.Reader, result workerResult) (*Prepared, error) {
	if result.Size <= 0 || result.Size > maxWorkerOutput || !fitDimensionsSafe(result.Width, result.Height) || len(result.Thumbnails) != 2 {
		return nil, ErrCannotFit
	}
	content := make([]byte, result.Size)
	if _, err := io.ReadFull(input, content); err != nil {
		return nil, err
	}
	prepared := &Prepared{Content: content, MIME: result.MIME, Width: result.Width, Height: result.Height, receipt: sha256.Sum256(content)}
	for index, thumbnail := range result.Thumbnails {
		expected := []string{"sm", "md"}[index]
		if thumbnail.Size != expected || thumbnail.Length <= 0 || thumbnail.Length > 1024*1024 || thumbnail.MIME != "image/png" && thumbnail.MIME != "image/jpeg" {
			return nil, ErrCannotFit
		}
		data := make([]byte, thumbnail.Length)
		if _, err := io.ReadFull(input, data); err != nil {
			return nil, err
		}
		prepared.Thumbnails = append(prepared.Thumbnails, Thumbnail{Size: expected, MIME: thumbnail.MIME, Data: data})
	}
	return prepared, nil
}

func writeWorkerHeader(output io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > 64*1024 {
		return ErrCannotFit
	}
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(data)))
	if _, err = output.Write(size[:]); err != nil {
		return err
	}
	_, err = output.Write(data)
	return err
}
func readWorkerHeader(input io.Reader, value any) error {
	var size [4]byte
	if _, err := io.ReadFull(input, size[:]); err != nil {
		return err
	}
	length := binary.BigEndian.Uint32(size[:])
	if length > 64*1024 {
		return ErrCannotFit
	}
	data := make([]byte, int(length))
	if _, err := io.ReadFull(input, data); err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

type workerBuffer struct {
	bytes.Buffer
	remaining int
}

func (w *workerBuffer) Write(data []byte) (int, error) {
	if len(data) > w.remaining {
		return 0, ErrCannotFit
	}
	w.remaining -= len(data)
	return w.Buffer.Write(data)
}
