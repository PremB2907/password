# Research Prototype: Offline Password Vault

This repository now functions as a working offline password vault and a reproducible security/performance research prototype.

## Research orientation

The active baseline KDF is PBKDF2-HMAC-SHA256. The code and documentation explicitly preserve that baseline and add a browser-compatible experimental Argon2id path for benchmarking. The project is designed to support research on:

- offline password-vault security
- password-based key derivation
- AES-GCM vault encryption
- independent vault-key architecture
- threshold recovery via Shamir secret sharing
- key rotation after recovery
- tamper detection and authentication failures
- KDF tradeoffs and benchmarking
- local encrypted storage overhead

## Current status

This is not a formal proof of security. It is a working prototype intended for research and evaluation. It preserves the normal vault functionality while making benchmarking reproducible and exportable.

## Project layout

```text
password-main/
├── README.md
├── docs/
│   ├── SECURITY_AUDIT.md
│   ├── THREAT_MODEL.md
│   ├── CRYPTOGRAPHIC_DESIGN.md
│   ├── EXPERIMENT_PROTOCOL.md
│   └── RESEARCH_RESULTS.md
└── vault/
    ├── package.json
    ├── src/
    │   ├── ui/
    │   ├── vault/
    │   ├── crypto/
    │   ├── recovery/
    │   ├── storage/
    │   └── research/
    ├── index.html
    ├── tsconfig.json
    └── vite.config.ts
```

## Production functionality

- create and unlock a vault with a master password
- add, edit, and copy stored credentials
- import and export encrypted vault JSON
- lock and unlock the vault locally in the browser
- recover using Shamir threshold shares and set a new password
- rotate the master password without changing the vault encryption key

## Research functionality

- KDF benchmark suite with PBKDF2 and experimental Argon2id
- threshold recovery benchmark across common share configurations
- tamper detection experiments for ciphertext, nonce, and wrapped material
- controlled offline-guessing simulation on synthetic data only
- synthetic vault throughput benchmarks for different entry counts
- key rotation validation
- JSON and CSV export of benchmark results

## Security and cryptographic baseline

The project uses:
- AES-GCM for vault payload and wrapped-key encryption
- random 16-byte salts for KDF separation
- random 12-byte nonces for AES-GCM
- random 32-byte vault keys
- Shamir secret sharing for recovery-key threshold distribution
- IndexedDB for local encrypted storage

The active KDF baseline is:
- PBKDF2-HMAC-SHA256
- 310,000 iterations by default
- configurable via the vault metadata and benchmark suite

A separate experimental Argon2id implementation is included for browser-compatible benchmarking, but the PBKDF2 baseline remains the default and is not silently replaced.

## Getting started

### Install

```bash
cd vault
npm install
```

### Run the vault and research dashboard

```bash
npm run dev -- --host 0.0.0.0
```

Then open:
- `http://localhost:5173/` for the production vault
- `http://localhost:5173/research` for the benchmark dashboard

### Build and test

```bash
npm run build
npm test
```

## Research docs

- [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- [docs/CRYPTOGRAPHIC_DESIGN.md](docs/CRYPTOGRAPHIC_DESIGN.md)
- [docs/EXPERIMENT_PROTOCOL.md](docs/EXPERIMENT_PROTOCOL.md)
- [docs/RESEARCH_RESULTS.md](docs/RESEARCH_RESULTS.md)

## Important limitations

- browser-based vaults are exposed to same-origin script compromise
- the vault does not provide server-side anti-guessing controls
- offline guessing remains a threat if the master password is weak
- the research suite is a local benchmark and not a formal proof or universal recommendation
- Document security-related decisions

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This is an MVP (Minimum Viable Product) and should be considered experimental software. While built with security best practices, it has not undergone professional security audits. Use at your own risk and always maintain secure backups of your recovery shares.

## 📞 Support

For questions, issues, or contributions:
- Create an issue on GitHub
- Review the existing documentation
- Check the security considerations section

---

**Built with ❤️ for secure password management**
