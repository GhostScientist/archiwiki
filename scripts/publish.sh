#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

show_help() {
  echo "Usage: ./scripts/publish.sh [OPTION]"
  echo
  echo "Build and publish semanticwiki"
  echo
  echo "Options:"
  echo "  --link              Link globally for local development"
  echo "  --global            Install globally from source"
  echo "  --public            Publish to public npm registry"
  echo "  --private           Publish to private registry (requires .npmrc)"
  echo "  --dry-run           Test publish without actually publishing"
  echo "  --pack              Create tarball without publishing"
  echo "  -h, --help          Show this help message"
  echo
  echo "Examples:"
  echo "  ./scripts/publish.sh --link      # For local development"
  echo "  ./scripts/publish.sh --public    # Publish to npmjs.com"
  echo "  ./scripts/publish.sh --private   # Publish to private registry"
}

# Build first
echo "🔧 Building semanticwiki..."
npm install
npm run build

case "${1:-}" in
  --link)
    echo "🔗 Linking globally (for local development)..."
    npm link
    echo
    echo "✅ Linked! You can now run 'semanticwiki' from any directory."
    echo "📁 The agent will use the current directory as its workspace."
    echo
    echo "To unlink later: npm unlink -g semanticwiki"
    ;;

  --global)
    echo "📦 Installing globally..."
    npm install -g .
    echo
    echo "✅ Installed! You can now run 'semanticwiki' from any directory."
    ;;

  --public)
    echo "📦 Publishing to public npm registry..."
    echo
    read -p "Publish semanticwiki to npmjs.com? (y/N) " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      npm publish --access public
      echo
      echo "✅ Published! Install with: npm install -g semanticwiki"
    else
      echo "Cancelled."
    fi
    ;;

  --private)
    if [[ ! -f .npmrc ]]; then
      echo "⚠️  No .npmrc file found!"
      echo "Copy .npmrc.example to .npmrc and configure your private registry:"
      echo "  cp .npmrc.example .npmrc"
      echo "  # Edit .npmrc with your registry URL and auth token"
      exit 1
    fi
    echo "📦 Publishing to private registry..."
    npm publish
    echo
    echo "✅ Published to private registry!"
    ;;

  --dry-run)
    echo "🧪 Dry run - testing publish..."
    npm publish --dry-run
    echo
    echo "✅ Dry run complete. Use --public or --private to actually publish."
    ;;

  --pack)
    echo "📦 Creating tarball..."
    npm pack
    echo
    echo "✅ Tarball created. You can distribute this .tgz file directly."
    ;;

  -h|--help)
    show_help
    ;;

  *)
    show_help
    ;;
esac
