# Store dashboard (Tindahan POS)

View-only sales dashboard for the store's phone. The POS on the store PC sends `data/summary.json` here once an hour
(Settings → Sync & backup → Online dashboard). That file is **encrypted** with the owner's passphrase (AES-256-GCM,
key from PBKDF2-SHA256); this page asks the passphrase and decrypts it in the browser. Nothing here can be read
without the passphrase, and nothing on this page can change the POS.

Files: `index.html`, `app.js` (page), `crypto.js` (decryption, WebCrypto), `style.css`. No outside scripts or fonts.
