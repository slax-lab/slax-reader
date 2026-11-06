# Spec Delta

## REMOVED Requirements

### Requirement: Merged task pull requests trigger archive evaluation

**Reason**: Merge-triggered archive automation is retired because its operational complexity exceeds its value.

**Migration**: The change author archives after the task pull request merges through a separate human-reviewed documentation pull request.

### Requirement: Archive eligibility preserves unfinished work and evidence

**Reason**: This requirement belongs to the retired automatic evaluation path.

**Migration**: The author continues to classify every unchecked task before archiving; no automatic classification replaces that review.

### Requirement: Same-capability deltas are archived in a safe order

**Reason**: Automatic dependency inspection and serialized archive evaluations are removed with the workflow.

**Migration**: Authors sequence changes affecting the same capability under the existing OpenSpec workflow and review requirements.

### Requirement: A valid archive produces one reviewed documentation pull request

**Reason**: The system no longer creates archive pull requests automatically.

**Migration**: The author creates one documentation archive pull request and submits it through the normal review process.

### Requirement: Humans control archive completion

**Reason**: This requirement describes the lifecycle of automatically created archive pull requests, which are removed.

**Migration**: Human review and merge remain mandatory for every author-created archive pull request.

### Requirement: Reviewer notification uses the existing readiness path

**Reason**: Archive-specific reviewer instructions and bot-notification behavior are retired with automatic archive pull request creation.

**Migration**: Ordinary documentation pull requests use the existing review and notification rules without an archive-specific path.

### Requirement: Archive is not an implementation checklist item

**Reason**: This requirement ties task completion to the retired merge-triggered evaluation.

**Migration**: Implementation and pre-merge verification complete the task PR; the author performs the archive only after that PR merges.
