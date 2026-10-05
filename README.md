# Zero-Trust Password Vault

A secure, offline-first password manager with end-to-end encryption and Shamir secret sharing for recovery.

## 🌟 Features

### Security Features
- **Zero-Knowledge Architecture**: Only encrypted data is stored locally
- **End-to-End Encryption**: All data encrypted using AES-GCM with WebCrypto API
- **Master Password Protection**: PBKDF2-SHA256 key derivation (310,000 iterations)
- **Shamir Secret Sharing**: Split recovery key into multiple shares (k-of-n)
- **Offline-First**: No server required - everything stored locally in IndexedDB

### User Features
- **Vault Management**: Create, lock, unlock, and delete password vaults
- **Password Entries**: Store unlimited password entries with title, username, and password
- **Secure Recovery**: Recover vault using Shamir shares and set new master password
- **Import/Export**: Backup and restore vault using encrypted JSON blobs
- **Modern UI**: Clean, responsive interface with dark/light theme support

## 🏗️ Architecture

### Project Structure
```
password/
├── README.md                 # This file
└── vault/                    # Main application
    ├── src/
    │   ├── ui/
    │   │   └── App.tsx       # Main React component
    │   ├── vault/
    │   │   ├── schema.ts     # TypeScript schemas with Zod
    │   │   ├── crypto.ts     # Cryptographic utilities
    │   │   ├── storage.ts    # IndexedDB storage layer
    │   │   └── vault.ts      # Core vault logic
    │   ├── main.tsx          # React entry point
    │   └── style.css         # Application styles
    ├── public/               # Static assets
    ├── index.html            # HTML template
    ├── package.json          # Dependencies and scripts
    └── vite.config.ts        # Vite configuration
```

### Security Architecture

#### Encryption Flow
1. **Vault Creation**:
   - Generate random 32-byte `vaultKey` for data encryption
   - Generate random 32-byte `recoveryKey` for emergency recovery
   - Derive `masterKEK` from master password using PBKDF2-SHA256
   - Encrypt `vaultKey` with both `masterKEK` and `recoveryKey`
   - Split `recoveryKey` into Shamir shares

2. **Data Encryption**:
   - All vault data encrypted with AES-GCM using `vaultKey`
   - Each encryption operation uses a unique 12-byte nonce
   - Base64 encoding for storage compatibility

3. **Recovery Process**:
   - Combine k-of-n Shamir shares to reconstruct `recoveryKey`
   - Decrypt `vaultKey` using `recoveryKey`
   - Set new master password and re-encrypt `vaultKey`

#### Data Schema
```typescript
// Vault Entry
interface VaultEntry {
  id: string
  title: string
  username: string
  password: string
  createdAt: number
  updatedAt: number
}

// Encrypted Vault Blob
interface VaultBlobV1 {
  version: 1
  createdAt: number
  kdf: {
    name: 'pbkdf2-sha256'
    saltB64: string
    iterations: number
    dkLen: number
  }
  wrap: {
    master: { nonceB64: string, ctB64: string }
    recovery: { nonceB64: string, ctB64: string }
  }
  payload: { nonceB64: string, ctB64: string }
}
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Modern web browser with WebCrypto support

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/PremB2907/password.git
   cd password
   ```

2. **Install dependencies**:
   ```bash
   cd vault
   npm install
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to the URL shown by Vite (usually `http://localhost:5173`)

### Building for Production
```bash
npm run build
npm run preview
```

## 📖 Usage Guide

### Creating a New Vault
1. Open the application
2. Set a strong master password (minimum 8 characters)
3. Configure Shamir shares:
   - **Shares (n)**: Total number of recovery shares to generate
   - **Threshold (k)**: Minimum shares needed for recovery
4. Click **Create Vault**
5. **IMPORTANT**: Save your recovery shares immediately - they're shown only once!

### Daily Use
1. **Unlock**: Enter your master password to access the vault
2. **Add Entries**: Store passwords with title, username, and password
3. **Copy Passwords**: Click the copy button next to any entry
4. **Lock**: Secure the vault when not in use

### Recovery Process
If you forget your master password:
1. Click **Recover** on the unlock screen
2. Paste at least `k` recovery shares (one per line)
3. Set a new master password
4. Your vault will be restored with the new password

### Backup and Restore
- **Export**: Copy the encrypted vault JSON to clipboard
- **Import**: Paste a previously exported vault JSON to restore

## 🔧 Technology Stack

### Frontend
- **React 19** - Modern UI framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server

### Cryptography
- **WebCrypto API** - Native browser cryptography
- **@noble/ciphers** - Additional cryptographic utilities
- **@noble/hashes** - Hashing functions
- **shamirs-secret-sharing** - Shamir secret sharing implementation

### Storage & Validation
- **idb-keyval** - Simple IndexedDB wrapper
- **Zod** - Runtime type validation

## 🔒 Security Considerations

### Threat Model
- **Trusted Environment**: Assumes secure client device
- **No Server Trust**: Zero-knowledge architecture prevents server access to plaintext
- **Recovery Security**: Shamir shares provide distributed recovery without single point of failure

### Security Best Practices
- **Strong Passwords**: Use master passwords with high entropy
- **Secure Share Distribution**: Distribute recovery shares to trusted parties/devices
- **Regular Backups**: Export vault JSON regularly and store securely
- **Browser Security**: Use up-to-date browsers with security patches

### Limitations
- **No Cloud Sync**: Currently offline-only (can be extended with encrypted sync)
- **PBKDF2**: Uses PBKDF2-SHA256 (future versions may include Argon2id)
- **Single Device**: No multi-device synchronization yet

## 🛣️ Roadmap

### Planned Features
- [ ] **Argon2id KDF**: WASM-based Argon2id implementation
- [ ] **TOTP Support**: Time-based one-time password generation
- [ ] **Biometric Unlock**: Platform-specific biometric authentication
- [ ] **Password Health**: Weak password detection and breach checking
- [ ] **Encrypted Cloud Sync**: Optional end-to-end encrypted synchronization
- [ ] **Mobile App**: React Native application
- [ ] **Browser Extension**: Auto-fill functionality
- [ ] **Phishing Detection**: URL-based phishing protection

### Security Enhancements
- [ ] **Memory Protection**: Secure memory handling for sensitive data
- [ ] **Audit Logging**: Track vault access and modifications
- [ ] **Multi-Factor Auth**: Additional authentication factors
- [ ] **Hardware Security**: WebAuthn/FIDO2 support

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Standards
- Use TypeScript for all new code
- Follow existing code style and patterns
- Add comprehensive tests for security-critical functions
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
