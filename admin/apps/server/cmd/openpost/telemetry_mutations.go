package main

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/telemetry"
)

// HTTP acceptance is distinct from eventual publishing or job success. Observe
// REST writes, including handled validation/permission/rate-limit responses,
// without collecting bodies or generating an event for every background read.
func captureAPIMutation(recorder telemetry.Recorder, c echo.Context) {
	if recorder == nil || !recorder.Enabled() || !c.Response().Committed {
		return
	}
	switch c.Request().Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return
	}
	route := c.Path()
	status := c.Response().Status
	if !strings.HasPrefix(route, "/api/v1/") || strings.HasPrefix(route, "/api/v1/mcp") || strings.Contains(route, "*") || status < 200 || status >= 600 {
		return
	}
	if err := recorder.Capture(c.Request().Context(), telemetry.Event{
		Name: telemetry.EventAPIMutationCompleted, DistinctID: telemetry.BrowserDistinctID(c.Request().Context()),
		Properties: map[string]any{"route": route, "method": c.Request().Method, "http_status": status, "response_class": strconv.Itoa(status/100) + "xx"},
	}); err != nil {
		log.Printf("Failed to enqueue API response telemetry: %v", err)
	}
}
