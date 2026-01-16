#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo -e "${YELLOW}Releasing semanticwiki $TAG${NC}"
echo ""

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Error: Tag $TAG already exists${NC}"
  echo "Bump the version in package.json first, then update CHANGELOG.md"
  exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo -e "${RED}Error: You have uncommitted changes${NC}"
  echo "Commit or stash your changes before releasing"
  exit 1
fi

# Extract release notes from CHANGELOG.md
# Gets content between current version header and next version header (or EOF)
echo -e "${YELLOW}Extracting release notes from CHANGELOG.md...${NC}"
NOTES=$(awk "/^## \[$VERSION\]/{flag=1; next} /^## \[/{flag=0} flag" CHANGELOG.md)

if [[ -z "$NOTES" ]]; then
  echo -e "${RED}Error: No release notes found for version $VERSION in CHANGELOG.md${NC}"
  echo "Add release notes under '## [$VERSION]' header first"
  exit 1
fi

echo -e "${GREEN}Found release notes:${NC}"
echo "$NOTES" | head -10
echo "..."
echo ""

# Build
echo -e "${YELLOW}Building...${NC}"
npm run build

# Run tests
echo -e "${YELLOW}Running tests...${NC}"
npm test

# Confirm before publishing
echo ""
echo -e "${YELLOW}Ready to release $TAG${NC}"
echo "This will:"
echo "  1. Create git tag $TAG"
echo "  2. Push tag to origin"
echo "  3. Create GitHub release with notes from CHANGELOG.md"
echo "  4. Publish to npm"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Aborted${NC}"
  exit 0
fi

# Create and push tag
echo -e "${YELLOW}Creating tag $TAG...${NC}"
git tag -a "$TAG" -m "Release $TAG"

echo -e "${YELLOW}Pushing tag to origin...${NC}"
git push origin "$TAG"

# Create GitHub release
echo -e "${YELLOW}Creating GitHub release...${NC}"
gh release create "$TAG" \
  --title "$TAG" \
  --notes "$NOTES"

# Publish to npm
echo -e "${YELLOW}Publishing to npm...${NC}"
npm publish

echo ""
echo -e "${GREEN}Successfully released $TAG${NC}"
echo ""
echo "Links:"
echo "  npm: https://www.npmjs.com/package/semanticwiki/v/$VERSION"
echo "  GitHub: $(gh release view $TAG --json url -q .url)"
