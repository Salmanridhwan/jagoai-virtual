// Package fonts exposes the licensed font assets shared by server-side image renderers.
package fonts

import "embed"

//go:embed *.ttf *.ttc
var Files embed.FS
