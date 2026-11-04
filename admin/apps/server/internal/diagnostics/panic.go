package diagnostics

import "fmt"

// PanicError preserves the original stack when an owning service recovers a
// panic before returning it through the worker's ordinary failure handling.
type PanicError struct {
	Recovered any
	Frames    []Frame
}

func (e *PanicError) Error() string {
	return fmt.Sprintf("worker panic: %v", e.Recovered)
}
