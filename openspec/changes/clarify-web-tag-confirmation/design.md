# Clarify what the tag confirmation button counts

## Context

After attaching a tag and reopening its menu, the button says Done (0). Its number counts pending additions while checkmarks include previously attached tags.

## Goals / Non-Goals

Label the idle action Done and label pending additions with their count. Keep existing tags visibly attached.

## Decisions

Choose localized labels from pending.size. Keep attachedIds and the existing submit and transport logic. With no additions Done dismisses the panel. With additions the action names their count and commits them.

## Risks / Trade-offs

First of the two bookmark-tag-presentation proposals.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
