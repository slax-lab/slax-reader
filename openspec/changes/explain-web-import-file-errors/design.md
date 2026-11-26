# Explain an unsupported import file type

## Context

Selecting an existing .txt file for Pinboard shows the same message as a missing file, although the client already knows the filename and accepted extensions.

## Goals / Non-Goals

Name the unsupported format and list the selected importer's accepted types. Keep the file picker available for immediate correction.

## Decisions

Build the format guidance from the selected source's existing accept list. Keep cancellation silent. Show size, parse and file-read errors through their own applicable paths and continue to validate actual content in preview.

## Risks / Trade-offs

First of the two web-library-import-feedback proposals.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
