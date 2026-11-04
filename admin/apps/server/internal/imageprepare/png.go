// Package imageprepare prepares publication images without changing their originals.
package imageprepare

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
)

const maxFilteredBytes = 128 * 1024 * 1024

var signature = []byte("\x89PNG\r\n\x1a\n")

// OptimizePNG recompresses the existing filtered pixels. It retains every other
// chunk verbatim, including color profiles, orientation and animation frames.
// A non-PNG or an image that cannot be made smaller is returned unchanged.
func OptimizePNG(ctx context.Context, input []byte) ([]byte, error) {
	if !bytes.HasPrefix(input, signature) {
		return input, nil
	}
	data, err := parsePNGData(input)
	if err != nil {
		return nil, err
	}
	compressed, err := recompressPNG(ctx, data.compressed)
	if err != nil {
		return nil, err
	}
	output := replacePNGData(input, data, compressed)
	if len(output) >= len(input) {
		return input, nil
	}
	return output, nil
}

type pngData struct {
	compressed []byte
	first      int
	end        int
}

func parsePNGData(input []byte) (pngData, error) {
	var imageData bytes.Buffer
	first, end := -1, 0
	for pos := len(signature); pos < len(input); {
		if len(input)-pos < 12 {
			return pngData{}, errors.New("truncated PNG chunk")
		}
		length := uint64(binary.BigEndian.Uint32(input[pos:]))
		if length+12 > uint64(len(input)-pos) {
			return pngData{}, errors.New("truncated PNG data")
		}
		next := pos + int(length) + 12
		chunk := input[pos+4 : next-4]
		if crc32.ChecksumIEEE(chunk) != binary.BigEndian.Uint32(input[next-4:next]) {
			return pngData{}, errors.New("invalid PNG checksum")
		}
		kind := string(chunk[:4])
		if kind == "IDAT" {
			if first < 0 {
				first = pos
			}
			imageData.Write(chunk[4:])
		}
		if kind == "IEND" {
			end = next
			break
		}
		pos = next
	}
	if first < 0 || end == 0 {
		return pngData{}, errors.New("incomplete PNG")
	}
	return pngData{compressed: imageData.Bytes(), first: first, end: end}, nil
}

func recompressPNG(ctx context.Context, input []byte) ([]byte, error) {
	reader, err := zlib.NewReader(bytes.NewReader(input))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	var compressed bytes.Buffer
	writer, err := zlib.NewWriterLevel(&compressed, zlib.BestCompression)
	if err != nil {
		return nil, err
	}
	count, err := io.Copy(writer, &contextReader{ctx: ctx, reader: io.LimitReader(reader, maxFilteredBytes+1)})
	if closeErr := writer.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	if count > maxFilteredBytes {
		return nil, errors.New("PNG optimization memory limit exceeded")
	}
	return compressed.Bytes(), nil
}

func replacePNGData(input []byte, data pngData, compressed []byte) []byte {
	var output bytes.Buffer
	output.Write(signature)
	for pos := len(signature); pos < data.end; {
		next := pos + int(binary.BigEndian.Uint32(input[pos:])) + 12
		if string(input[pos+4:pos+8]) != "IDAT" {
			output.Write(input[pos:next])
		} else if pos == data.first {
			_ = binary.Write(&output, binary.BigEndian, uint32(len(compressed)))
			output.WriteString("IDAT")
			output.Write(compressed)
			checksum := crc32.NewIEEE()
			_, _ = checksum.Write([]byte("IDAT"))
			_, _ = checksum.Write(compressed)
			_ = binary.Write(&output, binary.BigEndian, checksum.Sum32())
		}
		pos = next
	}
	return output.Bytes()
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
