<div align="center">
<img src="https://r-beta.slax.com/icon.png" />
<h1> <a href="https://slax.com/slax-reader.html">Slax Reader </a> </h1>
<h1>Slax Reader: Start Reading Smarter   
</h1>

![Stars](https://img.shields.io/github/stars/slax-lab/slax-reader?style=flat)  [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) [![Twitter](https://img.shields.io/twitter/url/https/twitter.com/cloudposse.svg?style=social&label=Follow%20%40SlaxReader)](https://twitter.com/SlaxReader)

</div>

<div align="center">
    <a href="https://r.slax.com">Official Website</a>
 |
    <a href="https://t.me/slax_app">Join Our Community</a> 
</div>
</br>

[参与指南（无需开发环境）](docs/contributing/README.md) · [Contributing](docs/contributing/README.en.md) · [Documentation](docs/README.md)

We don’t just store content; we help you *understand* it.

[Slax Reader](https://r.slax.com) is more than just a "read-it-later" app—it's your free, AI-powered research companion. Save web pages, highlight, comment, and discuss with others. Use the AI assistant to instantly clarify confusing concepts or explore topics in more depth. It's also a knowledge base where you can follow your favorite creators and track their saved content.

<img width="1440" alt="Screen Shot 2025-03-12 at 2 49 03 PM" src="https://github.com/user-attachments/assets/87fd0c17-b60b-4461-a7d6-d516832a53b6" /> <br>


>This project is at its beginning, so it can be shaped and improved with your feedback and help! If you like it, star it 🌟! If you want a feature or find a bug, open an issue.


<div align="center">

</div>
</br>



# 🌟 Main Features
- [x] **Save Once, Keep Forever**
  - Cache web pages, X threads, and YouTube videos **indefinitely**.
  - Coming soon: PDF, newsletters, and more.

- [x] **AI That Works While You Read**
  - **Instant Explanations**
    - Highlight a confusing phrase or paragraph? Slax explains it in context.
  - **Big-Picture Breakdowns**
    - Summaries on Demand: Request a summary of any long read.
    - Interactive mind maps
    - Structured outlines (click any section to jump to the full text)
  - **Deeper Learning**
    - Engage with the AI assistant to debate ideas or explore complex topics deeper.

- [x] **Organize Smarter**
  - **Auto-tagging**
  - **Improved search**:
    - By keyword (“blockchain”)
    - By semantic meaning (“articles debunking climate myths”)

- [x] **Spark Conversations**
  - **Collaborative Reading**:
    - Highlight, comment, and share insights with one URL.
    - Anyone with the link can comment or reply—turn reading into dialogue.
  - **Shared Knowledge**:
    - Follow favorite creators to track their saved content.
    - Curate team libraries for collaborative research.

- [x] **Importing Libraries**
  - Slax Reader lets you import your Omnivore data directly, with support for other platforms currently in development.

# ✨ Get Slax Reader
#### Read on web

  - Web: visit [Slax Reader](https://r.slax.com) to create your free account (no downloads needed).

  - Browser Extensions (save links in one click): [Chrome Web Store](https://chromewebstore.google.com/detail/slax-reader/gdnhaajlomjkhahnmiijphnodkcfikfd) (also works on Edge)

#### Read on mobile

  - [Slax Reader Bot](https://t.me/slax_reader_bot): save articles directly from your phone.

#### Coming soon

  - iOS/Android/Desktop apps (under active development).

# 🚀 Development and self-hosting

Web and Extension source now live in this repository. Start with the
[developer setup guide](docs/contributing/development.en.md) or [中文开发指南](docs/contributing/development.md).
The backend remains external during this migration; local business flows require its development configuration.
See [migration status and remaining verification](docs/migrations/final-verification.md) before planning deployment.

# 🤝 How to Contribute

You can report a problem, suggest an improvement, edit documentation, or improve translations without installing a development environment.
Start with [Contributing](docs/contributing/README.en.md) / [参与指南（中文）](docs/contributing/README.md),
and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

# 💖 Contributors
💖 [Thank you to every contributor who helps make Slax Reader better](https://github.com/slax-lab/slax-reader-api/graphs/contributors) 💖

<img src="https://contrib.rocks/image?repo=slax-lab/slax-reader-api" alt="contributors">

# 🎉 Shoutouts
Slax Reader is made possible by the remarkable open-source projects and tools crafted by developers worldwide. We deeply appreciate the maintainers and contributors behind:  
- 🚀 [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- 📖 [readability](https://github.com/mozilla/readability)


# 📝 License

`Slax Reader` is licensed under the [Apache License 2.0](LICENSE). The community version is completely free, open-source, and will remain so forever.

Copyright is held by The Slax Reader Contributors; see [NOTICE](NOTICE) for details.

## v2 development

[Documentation / 文档导航](docs/README.md) · [Repository map / 目录说明](docs/architecture/frontend.md) ·
[Web guide](apps/web/README.md) · [Extension guide](apps/extension/README.md)

Shared libraries live in [packages](packages); a library belongs there when at least two apps use it.
See [migration progress](docs/migrations/slax-reader-web-extension.md). The backend remains external.
