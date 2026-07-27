# Contributing to Dosmos

Dosmos is open source under the [MIT license](LICENSE), but it is a **read-only open source project: external contributions are not accepted.**

This isn't personal — it's a deliberate choice. The project is built and maintained by a solo developer, and keeping a single copyright holder keeps the project's licensing options simple. Pull requests will be closed with a pointer to this file, regardless of quality.

## What you can do

- **Use it** — the MIT license lets you use, modify, and redistribute the code freely.
- **Fork it** — if you want to take the project in your own direction, forks are welcome and encouraged. That's what the license is for.
- **Report bugs** — issues are the best way to help. Describe what happened, what you expected, and how to reproduce it. Include your OS and app version.
- **Suggest features** — open an issue describing the use case. No promises, but real-world use cases genuinely shape what gets built.
- **Join the community** — questions and discussion happen on [Discord](https://discord.com/invite/dYGPPH6tPC).

## What will be closed

- Pull requests (including typo fixes and documentation changes)
- Issues that are patches in disguise ("here's the code, just paste it in")

## Building from source

If you're forking or just want to run the app yourself:

### Prerequisites

- Node.js 20+
- npm
- macOS, Windows, or Linux

### Development

```bash
git clone https://github.com/assentorp/dosmos.git
cd dosmos
npm install
npm run dev
```

This starts the Vite dev server and Electron concurrently with hot reload.

### Building

```bash
npm run build        # Current platform
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build:linux  # Linux
```

Output goes to the `release/` directory.
