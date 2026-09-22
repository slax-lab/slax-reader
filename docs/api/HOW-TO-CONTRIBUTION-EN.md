# 🌟 Contribution Guidelines

Thank you for considering contributing to our project! We welcome you to join our open-source community as a contributor. It is developers like you who make this project even better.

## 🤔 How to Contribute?

### 🐞 Reporting Bugs

If you discover a bug, please open an issue and provide the following details:

- A clear, descriptive issue title
- Step-by-step description to reproduce the problem
- Any additional information or screenshots that might help us understand the issue

### 💡 Suggesting Improvements

We are always open to new ideas! If you have a suggestion, please:

- Use the "Feature Request" issue template or create a new issue
- Describe the enhancement you would like and explain why it would be useful

### 🔰 Your First Code Contribution

Not sure where to start? You can find beginner-friendly issues with the "good first issue" label. Working on these issues can help you familiarize yourself with the codebase before tackling more complex problems.

### 🔄 Pull Requests

When you're ready to make code changes, please create a Pull Request:

1. Fork the repository and clone it to your local machine
2. Create a new branch: `git checkout -b your-branch-name`
3. Make your changes
4. After completing necessary tests and verification locally, commit your changes using the following format for commit messages:

   ```
   emoji short description

   emoji issue: #xxx (Issue Number)
   ```

   The emoji should correspond to the following types:

   - ✨ (New feature)
   - 🐛 (Bug fix)
   - ♻️ (Code refactoring)
   - ⚡ (Performance improvement)
   - 🔧 (Infrastructure/tools)
   - 🧪 (Testing)
   - 📝 (Documentation)
   - ...[See more](https://gist.github.com/parmentf/035de27d6ed1dce0b36a)

5. Push your changes to your remote branch and open a Pull Request

### 📜 Contributor Agreement

**Important note:** Your submitted Pull Request may be merged or incorporated into our commercial version. Before submitting a PR, you need to sign our contributor informed consent.

We use [CLA Assistant](https://github.com/cla-assistant/cla-assistant) Bot to manage this process. When you submit your first PR, the CLA Assistant Bot will automatically add a link in the PR comments guiding you through the signing process. You only need to click the link and follow the prompts to complete the signing. This process only needs to be completed once during your first contribution.

Once the signing process is complete, the Bot will automatically update your PR status, indicating your agreement to our terms. Please note that PRs without a signed informed consent cannot be merged.

## 🎨 Code Style Guide

Our project follows these core specifications:

### 1. Architecture Design

- **Domain-Driven Design (DDD)**
  - Clear layered architecture: presentation layer, application layer, domain layer, and infrastructure layer
  - Use of explicit bounded contexts to separate different business domains
  - Ensuring one-way flow of dependencies between layers

### 2. Development Standards

- **Dependency Injection**

  - Using decorators to implement dependency injection and inversion of control
  - Avoiding singletons and static methods
  - Injecting dependencies through constructors to improve code testability

- **TypeScript Coding Standards**

  - File naming: use camelCase (e.g., `userService.ts`)
  - Class naming: use PascalCase (e.g., `UserService`)
  - Method naming: use camelCase (e.g., `createUser`)
  - Interface naming: use PascalCase (e.g., `UserInterface`)

- **Asynchronous Processing**
  - Prioritize using async/await for asynchronous operations
  - Avoid callback hell, keep code flat

### 3. Code Quality

- **Error Handling**

  - Use custom error classes for error categorization
  - Unified error handling mechanism
  - Standardized error response format

- **Comment Standards**

  - Provide clear documentation comments for public APIs
  - Add necessary explanatory comments for complex logic
  - Use TODO/FIXME and other markers for issues to be addressed

Please ensure your code complies with these guidelines to maintain consistency and maintainability in the codebase. If in doubt, refer to existing code implementations.

## 🧪 Testing

Ensure your changes are covered by tests (where applicable). Run existing tests to make sure everything works as expected.

## 🤝 Code of Conduct

Please note that all participants in this project should follow our Code of Conduct. By participating, you agree to abide by its terms.

### ✨ Our Pledge

In the interest of fostering an open and welcoming environment, we as contributors and maintainers pledge to ensure participation in our project and community is a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual orientation.

### 📏 Our Standards

Behaviors that contribute to creating a positive environment include:

- Using welcoming and inclusive language
- Respecting different viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

We look forward to your contributions! Thank you for your support!
