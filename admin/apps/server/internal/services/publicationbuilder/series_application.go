package publicationbuilder

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

func (application *Application) UpdateSeriesConcept(ctx context.Context, userID, buildID, itemID string, revision int, title, brief string) (Build, error) {
	build, err := application.Get(ctx, userID, buildID)
	if err != nil {
		return Build{}, err
	}
	if build.State != BuildStateReady || build.Result == nil {
		return Build{}, ErrBuildNotReady
	}
	index := slices.IndexFunc(build.Result.Series, func(item SeriesConcept) bool { return item.ID == itemID })
	if index < 0 {
		return Build{}, ErrInvalidOption
	}
	item := &build.Result.Series[index]
	title, brief = strings.TrimSpace(title), strings.TrimSpace(brief)
	if item.Revision == revision+1 && item.Title == title && item.Brief == brief {
		return build, nil
	}
	if item.Revision != revision || item.ChildBuildID != "" {
		return Build{}, ErrBuildNotReady
	}
	if err := validateSeriesConcept(title, brief, item.Evidence); err != nil {
		return Build{}, err
	}
	if item.Title == title && item.Brief == brief {
		return build, nil
	}
	item.Title = title
	item.Brief = brief
	item.Revision++
	if err := application.saveSeries(ctx, userID, build); err != nil {
		return Build{}, err
	}
	return application.Get(ctx, userID, buildID)
}

// Reserving an immutable child identity before enqueue makes a crash or lost
// response recoverable. Each selected concept has its own normal durable build.
func (application *Application) StartSeriesConcept(ctx context.Context, userID, buildID, itemID string, revision int) (Build, error) {
	parent, err := application.Get(ctx, userID, buildID)
	if err != nil {
		return Build{}, err
	}
	if parent.State != BuildStateReady || parent.Result == nil {
		return Build{}, ErrBuildNotReady
	}
	index := slices.IndexFunc(parent.Result.Series, func(item SeriesConcept) bool { return item.ID == itemID })
	if index < 0 {
		return Build{}, ErrInvalidOption
	}
	item := &parent.Result.Series[index]
	if item.Revision != revision {
		return Build{}, ErrBuildNotReady
	}
	var record BuildRecord
	if err := application.db.NewSelect().Model(&record).Where("id = ? AND created_by_id = ?", buildID, userID).Scan(ctx); err != nil {
		return Build{}, err
	}
	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return Build{}, err
	}
	if request.SourceSnapshot == nil {
		return Build{}, ErrBuildNotReady
	}
	var authority workspaceaccess.StoredAuthority
	if err := decodeStoredJSON(record.AuthorityJSON, &authority); err != nil {
		return Build{}, err
	}
	if err := application.authorizeStored(ctx, authority); err != nil {
		return Build{}, err
	}
	key := fmt.Sprintf("series:%s:%s:%d", buildID, itemID, revision)
	if item.ChildBuildID == "" {
		item.ChildBuildID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(key)).String()
		if err := application.saveSeries(ctx, userID, parent); err != nil {
			return Build{}, err
		}
	}
	request.Input.SeriesCount = 0
	request.Input.OptionCount = 0
	// Choosing a concept is an authored direction. The original source remains
	// intact, so the normal writer and reviewer can verify the selected angle.
	request.Input.Direction.Angle = item.Brief
	child, _, err := application.Enqueue(ctx, CreateBuildRequest{WorkspaceID: record.WorkspaceID, CreatedByID: userID, IdempotencyKey: key, Authority: authority, Input: request.Input, ContextURLs: request.ContextURLs, Assets: request.Assets, SocialSetID: request.SocialSetID, VoiceProfileID: request.VoiceProfileID, recordID: item.ChildBuildID, seriesOrigin: &SeriesOrigin{BuildID: buildID, ItemID: itemID, ItemRevision: revision}, sourceSnapshot: request.SourceSnapshot})
	return child, err
}

func (application *Application) saveSeries(ctx context.Context, userID string, build Build) error {
	encoded, err := json.Marshal(build.Result)
	if err != nil {
		return err
	}
	result, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).Set("result_json = ?", string(encoded)).Set("revision = revision + 1").Set("updated_at = ?", application.now().UTC()).Where("id = ? AND created_by_id = ? AND revision = ? AND state = ?", build.ID, userID, build.Revision, BuildStateReady).Exec(ctx)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrBuildNotReady
	}
	return nil
}
