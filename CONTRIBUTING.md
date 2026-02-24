# Contributing to Design In The Browser

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

### Prerequisites

- Node.js 20+
- npm
- macOS, Windows, or Linux

### Getting Started

```bash
git clone https://github.com/assentorp/ditb.git
cd ditb
npm install
npm run dev
```

This starts Vite dev server and Electron concurrently with hot reload.

### Building

```bash
npm run build        # Current platform
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build:linux  # Linux
```

## How to Contribute

1. **Open an issue first** -- For bugs, describe what happened and how to reproduce. For features, describe the use case.
2. **Fork and branch** -- Create a branch from `main` with a descriptive name.
3. **Keep changes focused** -- One fix or feature per PR. Small PRs are reviewed faster.
4. **Test your changes** -- Run `npm run typecheck` and `npm test` before submitting.
5. **Submit a PR** -- Describe what changed and why. Link the related issue.

Don't expect your PR to be merged quickly. I'm a solo developer.

## Code Style

- TypeScript throughout
- Follow existing patterns in the codebase
- No unnecessary dependencies

## Releases

Releases are handled by the maintainer only. Do not bump versions or create tags in PRs.

## Questions?

Open an issue or join the [Discord](https://discord.com/invite/dYGPPH6tPC).
