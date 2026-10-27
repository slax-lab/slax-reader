# Design

## Context

The human reviewed the initial broad scope and explicitly restricted the fix to GitHub Environment selection/display. API's job environment currently maps main to prod; Web's job environment already uses the base branch directly. API's separate DEPLOY_ENVIRONMENT also maps main to prod, selecting api/prod.toml and checking RUN_TYPE=prod.

## Goals / Non-Goals

**Goals:** Make the GitHub deployment destination and environment-scoped Actions settings use main for production.

**Non-Goals:** Renaming API configuration files, runtime values, cloud resources, or build profiles; modifying application code or deployment scripts; populating GitHub settings or deploying.

## Decisions

Change only API jobs.deploy.environment to the existing Web expression based on the merged PR base branch. Keep DEPLOY_ENVIRONMENT unchanged because it selects an internal private configuration, independently of GitHub's job environment. Keep all credential references and guards intact. A broad prod-to-main replacement would violate the clarified scope and could change production behavior.

Update the API operating guide so the main row selects GitHub Environment main but still selects api/prod.toml with the existing runtime values. Deployment Secrets belong to main; legacy secret names listed as provenance do not need renaming.

Use temporary read-only assertions instead of adding test code: parse both workflows, evaluate dev/beta/main selections, and compare API's parsed current workflow against its baseline after normalizing only jobs.deploy.environment. Confirm no app, script, template, or private configuration changed.

## Risks / Trade-offs

- Missing main environment settings stop deployment. Operators must provide them before rollout; no fallback to prod is introduced.
- PR #234 proposes the opposite Web mapping. Leave it untouched and flag the conflict for the human; do not merge both directions.
- Earlier completed deployment proposals contain historical prod Environment wording. This change supersedes only that naming; configuration/runtime behavior remains unchanged when those changes are archived.

## Migration Plan

Keep application/private configuration as-is, prepare main Environment settings separately, then promote the workflow change through dev and beta to main. Preserve the existing Environment branch policies for default-branch-loaded pull_request_target workflows. Rollback restores the single environment expression and the corresponding operator documentation; it requires no data or application migration.
