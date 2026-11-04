// Package providerlimits records official per-provider media limits shared by
// the capability catalogue and adapter validators. Record the official
// source and verification date here, and test both validation boundaries
// against the independently specified limits below.
package providerlimits

// Verified 2026-10-18 against the dev-null.sh open-source repository
// (nunomaduro/dev-null.sh, production branch):
//   - app/Models/Commit.php (MIN_BODY_LENGTH=3, MAX_BODY_LENGTH=4000
//     characters: Laravel's max rule counts mb_strlen after
//     CommitBodies::normalize collapses blank runs)
//   - app/Actions/CreateCommitImages.php (MAX_IMAGES=3,
//     MAX_DESCRIPTION_LENGTH=1000, MAX_SOURCE_DIMENSION=6000) plus
//     CreateCommitRequest::attachmentRules (jpeg/png/webp, Laravel
//     File::max '10mb' = 10*1024*1024 bytes at the API; the official commit
//     script additionally refuses files above 10240000 bytes client-side, so
//     files between those bounds succeed through the API this adapter speaks)
//   - app/Http/Controllers/Cli/CommitController.php plus the `commit` shell
//     script served at https://dev-null.sh/commit
//   - app/Http/Middleware/ThrottleCommits.php (PER_MINUTE=10)
const (
	DevNullMaxBodyCharacters = 4000
	DevNullMaxImages         = 3
	DevNullMaxImageBytes     = 10 * 1024 * 1024
	DevNullMaxImageDimension = 6000
)

// DevNullMaxBodyBytes is the byte-oriented alias kept for capability fields
// that carry byte budgets; the character limit above is authoritative.
const DevNullMaxBodyBytes = DevNullMaxBodyCharacters
