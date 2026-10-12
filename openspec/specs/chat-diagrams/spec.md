# chat-diagrams Specification

## Purpose

Lets users receive diagrams from the AI chat: when a user asks the assistant to draw a diagram, the answer is expressed in mermaid syntax and the web chat surface renders it as an actual diagram instead of a code block.

## Requirements

### Requirement: Diagram answers use mermaid format

When the user explicitly asks the AI chat to draw a diagram or chart, the assistant response SHALL express the diagram as a fenced code block with the `mermaid` language tag.

#### Scenario: User requests a diagram

- **WHEN** the user asks the chat assistant to draw a diagram (e.g. a swimlane chart of an article's process)
- **THEN** the assistant response contains the diagram as a ```mermaid fenced code block, not ASCII art, not another diagram language, and not a plain-text description

#### Scenario: No unprompted diagrams

- **WHEN** the user asks a question that does not call for a diagram
- **THEN** the assistant does not emit mermaid blocks merely because the format is available

### Requirement: Mermaid blocks render as diagrams in chat

An assistant message containing a closed `mermaid` fenced code block SHALL render that block as a diagram on the web chat surface: the web bookmark reader page (`pages/b/[id]`) and the web shared snapshot page (`pages/s/[id]`), both served by the same snapshot chat panel. The browser extension MAY continue to show mermaid blocks as code blocks (extension rendering is deferred; see proposal). Non-mermaid code blocks SHALL continue to render as syntax-highlighted code.

#### Scenario: Closed mermaid block renders as diagram

- **WHEN** an assistant message contains a complete ```mermaid fenced code block with valid syntax
- **THEN** the block is displayed as a rendered diagram instead of source code, on both web pages

#### Scenario: Other code blocks unaffected

- **WHEN** an assistant message contains a fenced code block in any other language
- **THEN** it renders as a syntax-highlighted code block exactly as before

#### Scenario: Diagram stays legible in the dark theme

- **WHEN** a diagram is rendered while the app theme is dark
- **THEN** the diagram sits on a fixed light backdrop — in the chat bubble and in the full-view overlay — so its edges, arrowheads and labels remain visible (mermaid renders a fixed light theme)

### Requirement: Streaming-safe rendering

While an assistant message is still streaming, an unclosed `mermaid` fence SHALL render as a regular code block. The diagram SHALL only be rendered once the closing fence has arrived.

#### Scenario: Unclosed fence during streaming

- **WHEN** a streaming assistant message contains an opening ```mermaid fence whose closing fence has not yet arrived
- **THEN** the accumulated content renders as a code block, with no render attempt and no error shown

#### Scenario: Fence closes at end of stream

- **WHEN** the closing fence of a mermaid block arrives
- **THEN** the code block is replaced by the rendered diagram

### Requirement: Render failure falls back to code block

If a mermaid block fails to render (for example invalid syntax emitted by the model), the surface SHALL display the original mermaid source as a code block together with an error notice. The surface SHALL NOT show a blank area or an unhandled error.

#### Scenario: Invalid mermaid syntax

- **WHEN** an assistant message contains a complete ```mermaid fenced code block whose syntax is invalid
- **THEN** the block displays the mermaid source as a code block plus a visible error notice

### Requirement: Diagram full-view inspection

A rendered diagram SHALL scale to fit the chat bubble width. Clicking the diagram SHALL open a full-view overlay showing the diagram at full fidelity with zoom and pan.

#### Scenario: Overview in bubble

- **WHEN** a rendered diagram is wider than the chat bubble
- **THEN** it is scaled down to fit the bubble width and remains recognizable as an overview

#### Scenario: Click to inspect

- **WHEN** the user clicks a rendered diagram
- **THEN** a full-view overlay opens where the user can zoom and pan the diagram, and the overlay can be dismissed
