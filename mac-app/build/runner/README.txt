# CI drops the universal llama-server here before packaging (mac-app.yml).
# Kept so a local `npm run build` with no binary still packages — the app
# then falls back to Homebrew at runtime, exactly as before bundling existed.
