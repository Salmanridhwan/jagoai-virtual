package passwordmail

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
)

func TestClientInvitationIncludesRoleAndAcceptanceLink(t *testing.T) {
	content, err := workspaceInvitationContent(transactionalmail.WorkspaceInvitationMessage{WorkspaceName: "Agency client", InviterName: "Agency", Role: "client", ExpiresAt: time.Now().Add(time.Hour), AcceptURL: "https://openpost.test/invite/example"})
	require.NoError(t, err)
	require.Contains(t, content.Text, "Role: Client")
	require.Contains(t, content.HTML, "https://openpost.test/invite/example")
}

func TestNotificationContentRejectsUnsafeURLsAndHeaderInjection(t *testing.T) {
	_, err := notificationContent(notificationMessage{
		Title: "Publish failed\r\nBcc: target@example.com", ActionURL: "javascript:alert(1)",
	})
	require.Error(t, err)

	content, err := notificationContent(notificationMessage{Title: "Publish failed\r\nBcc: target@example.com"})
	require.NoError(t, err)
	require.False(t, strings.ContainsAny(content.Subject, "\r\n"))
}
