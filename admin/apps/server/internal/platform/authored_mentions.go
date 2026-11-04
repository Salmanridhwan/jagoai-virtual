package platform

import (
	"strings"

	"github.com/openpost/backend/internal/posttext"
)

func encodeLinkedInCommentary(content string, settings map[string]any) (string, error) {
	projection, err := posttext.ReadProjection(content, "linkedin", "", settings)
	if err != nil {
		return "", err
	}
	if projection == nil {
		return encodeLinkedInPlaintext(content), nil
	}
	var output strings.Builder
	previous := 0
	for _, span := range projection.Spans {
		output.WriteString(encodeLinkedInPlaintextAt(content[previous:span.Start], previous, content))
		output.WriteString("@[")
		output.WriteString(linkedInPlaintextEscaper.Replace(span.Text))
		output.WriteString("](")
		output.WriteString(span.Target.ID)
		output.WriteByte(')')
		previous = span.End
	}
	output.WriteString(encodeLinkedInPlaintextAt(content[previous:], previous, content))
	return output.String(), nil
}
