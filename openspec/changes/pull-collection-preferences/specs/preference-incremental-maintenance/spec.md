## MODIFIED Requirements

### Requirement: Owner Collections share one strict aggregate

All Collections of one owner SHALL be published from a single owner aggregate maintained by article events. The aggregate SHALL keep members that explicitly share their article separate from members that inherit the owner's default share setting, so that the published Collection vector equals a full recomputation under the owner's current default. A published owner with an eligible member that has no available vector SHALL keep failing Collection publication with the missing dependency until the vector exists, after which the next event SHALL publish without a full rebuild. A Collection event SHALL publish that Collection from the stored aggregate, using the Collection's current status and the owner's current default share setting, without enumerating the owner's articles, reading article vectors, reading the recent action window or recomputing interest clusters. A Collection event for an owner without usable stored state SHALL rebuild that owner once, like an article event.

#### Scenario: Owner with two Collections
- **WHEN** a published owner with two Collections stars an article
- **THEN** both Collections are published with the same vector, which equals a full Collection refresh, without enumerating all members

#### Scenario: Member vector is missing
- **WHEN** a starred member of a published owner has no vector
- **THEN** each of the owner's Collections reports the missing dependency, and after the vector is written the next event publishes them

#### Scenario: Owner turns off the default share setting
- **WHEN** an owner with stored state, explicitly shared members and inheriting members turns off the default share setting and the Collection event is processed
- **THEN** the published Collection vector equals a full Collection refresh over only the explicitly shared members
- **AND** no owner article is enumerated, no article vector is read or rewritten and interest clusters are unchanged

#### Scenario: Owner turns the default share setting back on
- **WHEN** the same owner turns the default share setting on again and the Collection event is processed
- **THEN** the published Collection vector again includes the inheriting members and equals a full Collection refresh, without a rebuild

#### Scenario: Collection is disabled and re-enabled
- **WHEN** an owner disables the Collection and later enables it, and each Collection event is processed
- **THEN** the first event deletes the Collection vector and the second publishes the vector a full Collection refresh produces, neither rebuilding the owner

#### Scenario: Collection event without usable state
- **WHEN** a Collection event arrives for an owner whose stored state is absent or was written in an earlier storage layout (including legacy state recreated during a rollback)
- **THEN** the owner's state is rebuilt once from current rows and existing vectors, the Collection is published, and the next event for that owner is incremental

#### Scenario: Re-upgrade after legacy code changed state
- **WHEN** legacy tables have been recreated during a rollback while a previous v2 snapshot still exists
- **THEN** the next owner maintenance rebuilds from current rows and existing vectors rather than trusting that stale snapshot
- **AND** the rebuild removes the legacy tables transactionally and subsequent events resume incremental updates

## ADDED Requirements

### Requirement: Coverage counters are kept with the aggregate

The stored aggregate SHALL keep the counts of eligible articles, articles with an applied vector, and missing members per share group, updated in the same local transaction as the sums. Publication SHALL use these counts and SHALL NOT scan the stored per-article entries; it SHALL read a single missing member only when the counts report one. Reported coverage and Collection eligibility SHALL equal those of a full recomputation.

#### Scenario: Counts follow incremental events
- **WHEN** a sequence of save, star, unstar, share change, re-embed and delete events is processed incrementally
- **THEN** after each event the reported coverage and Collection member and missing counts equal a recount of the stored entries and a full recomputation

#### Scenario: Publication does not scan entries
- **WHEN** an incremental event publishes the user preference and the owner's Collections and no member is missing
- **THEN** no query reads the stored entries other than the event's own articles
