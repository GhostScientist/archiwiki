# Local Mode Testing Guide

This document provides public GitHub repositories of varying sizes and tech stacks for testing the `--full-local` mode of semanticwiki.

## Test Repositories

### Small Codebases (~100-500 files)

#### 1. **jq** - Lightweight JSON Processor (C)
- **URL**: https://github.com/jqlang/jq
- **Size**: ~300 files
- **Language**: C
- **Description**: Command-line JSON processor. Well-structured C codebase with clear architecture.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/jqlang/jq --full-local -o ./wiki-jq
  ```

#### 2. **httpie** - HTTP CLI Client (Python)
- **URL**: https://github.com/httpie/cli
- **Size**: ~200 files
- **Language**: Python
- **Description**: Modern HTTP client for the command line. Clean Python project structure.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/httpie/cli --full-local -o ./wiki-httpie
  ```

#### 3. **bat** - A cat Clone with Wings (Rust)
- **URL**: https://github.com/sharkdp/bat
- **Size**: ~150 files
- **Language**: Rust
- **Description**: Cat clone with syntax highlighting and Git integration.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/sharkdp/bat --full-local -o ./wiki-bat
  ```

---

### Medium Codebases (~500-2000 files)

#### 4. **GnuCOBOL** - COBOL Compiler (COBOL/C)
- **URL**: https://github.com/OCamlPro/gnucobol
- **Size**: ~1,200 files
- **Language**: COBOL, C
- **Description**: Free/open-source COBOL compiler. Excellent for testing COBOL parsing.
- **Why notable**: One of the most actively maintained COBOL projects. Tests the COBOL chunking capability.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/OCamlPro/gnucobol --full-local -o ./wiki-gnucobol
  ```

#### 5. **ripgrep** - Fast Search Tool (Rust)
- **URL**: https://github.com/BurntSushi/ripgrep
- **Size**: ~800 files
- **Language**: Rust
- **Description**: Extremely fast recursive search tool. Well-documented, great architecture.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/BurntSushi/ripgrep --full-local -o ./wiki-ripgrep
  ```

#### 6. **FastAPI** - Modern Python Web Framework (Python)
- **URL**: https://github.com/tiangolo/fastapi
- **Size**: ~600 files
- **Language**: Python
- **Description**: Modern, fast web framework for building APIs. Excellent documentation baseline.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/tiangolo/fastapi --full-local -o ./wiki-fastapi
  ```

#### 7. **esbuild** - Fast JavaScript Bundler (Go)
- **URL**: https://github.com/evanw/esbuild
- **Size**: ~1,500 files
- **Language**: Go
- **Description**: Extremely fast JavaScript bundler. Clean Go architecture.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/evanw/esbuild --full-local -o ./wiki-esbuild
  ```

---

### Large Codebases (~2000-10000 files)

#### 8. **Rust Compiler (rustc)** - Core Library (Rust)
- **URL**: https://github.com/rust-lang/rust
- **Size**: ~30,000+ files (use `--path` to focus)
- **Language**: Rust
- **Description**: The Rust programming language compiler.
- **Recommended**: Focus on specific directories
- **Test command**:
  ```bash
  # Focus on the standard library
  semanticwiki generate -r https://github.com/rust-lang/rust --full-local -o ./wiki-rust-std -p library/std

  # Or focus on the compiler frontend
  semanticwiki generate -r https://github.com/rust-lang/rust --full-local -o ./wiki-rustc -p compiler/rustc_parse --max-chunks 3000
  ```

#### 9. **Deno** - JavaScript/TypeScript Runtime (Rust/TypeScript)
- **URL**: https://github.com/denoland/deno
- **Size**: ~5,000 files
- **Language**: Rust, TypeScript
- **Description**: Modern JavaScript/TypeScript runtime. Mixed Rust/TS codebase.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/denoland/deno --full-local -o ./wiki-deno --max-chunks 5000
  ```

#### 10. **Neovim** - Vim-based Text Editor (C/Lua)
- **URL**: https://github.com/neovim/neovim
- **Size**: ~4,000 files
- **Language**: C, Lua
- **Description**: Modern Vim fork with improved architecture.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/neovim/neovim --full-local -o ./wiki-neovim --max-chunks 4000
  ```

---

### Enterprise/Mainframe Codebases (COBOL/JCL)

#### 11. **AWS CardDemo** - COBOL Sample Application
- **URL**: https://github.com/aws-samples/aws-mainframe-modernization-carddemo
- **Size**: ~100 files
- **Language**: COBOL, JCL
- **Description**: AWS sample mainframe application for modernization demos. Contains realistic COBOL/CICS patterns.
- **Why notable**: Official AWS sample with production-like COBOL patterns.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/aws-samples/aws-mainframe-modernization-carddemo --full-local -o ./wiki-carddemo
  ```

#### 12. **COBOL Programming Course**
- **URL**: https://github.com/openmainframeproject/cobol-programming-course
- **Size**: ~200 files
- **Language**: COBOL, JCL
- **Description**: Open Mainframe Project's COBOL course materials with sample programs.
- **Test command**:
  ```bash
  semanticwiki generate -r https://github.com/openmainframeproject/cobol-programming-course --full-local -o ./wiki-cobol-course
  ```

---

## Testing Matrix

| Repository | Size | Languages | Expected Time (Local 14B) | Expected Time (Local 7B) |
|------------|------|-----------|--------------------------|-------------------------|
| jq | Small | C | ~15-20 min | ~10-15 min |
| httpie | Small | Python | ~12-18 min | ~8-12 min |
| bat | Small | Rust | ~15-20 min | ~10-15 min |
| GnuCOBOL | Medium | COBOL/C | ~45-60 min | ~30-45 min |
| ripgrep | Medium | Rust | ~30-45 min | ~20-30 min |
| FastAPI | Medium | Python | ~25-35 min | ~18-25 min |
| esbuild | Medium | Go | ~40-55 min | ~28-40 min |
| Deno | Large | Rust/TS | ~2-3 hours | ~1.5-2 hours |
| Neovim | Large | C/Lua | ~2-3 hours | ~1.5-2 hours |
| CardDemo | Small | COBOL/JCL | ~20-30 min | ~15-20 min |

---

## Hardware Recommendations by Repository Size

### Small Repositories
- **Minimum**: 8GB RAM, any GPU or CPU-only
- **Recommended**: 16GB RAM, 6GB+ VRAM
- **Model**: `qwen2.5-coder-7b-q5` or `qwen2.5-coder-14b-q5`

### Medium Repositories
- **Minimum**: 16GB RAM, 8GB VRAM
- **Recommended**: 32GB RAM, 12GB+ VRAM
- **Model**: `qwen2.5-coder-14b-q5` or `qwen2.5-coder-32b-q4`

### Large Repositories
- **Minimum**: 32GB RAM, 16GB VRAM
- **Recommended**: 64GB RAM, 24GB+ VRAM
- **Model**: `qwen2.5-coder-32b-q4`
- **Note**: Use `--max-chunks` to limit memory usage

---

## Testing Checklist

### Basic Functionality
- [ ] Model auto-download works on first run
- [ ] Hardware detection identifies GPU correctly
- [ ] Model recommendation matches available hardware
- [ ] Progress bar shows during inference
- [ ] Wiki pages are generated with source references

### Quality Checks
- [ ] Generated diagrams render correctly (Mermaid)
- [ ] Source file:line references are accurate
- [ ] Cross-references between pages work
- [ ] Index page lists all generated pages

### Error Handling
- [ ] Graceful handling of insufficient memory
- [ ] Recovery from network errors during download
- [ ] Proper cleanup on Ctrl+C interrupt

### Ollama Backend (Power Users)
```bash
# Test with Ollama backend
ollama pull qwen2.5-coder:14b
semanticwiki generate -r https://github.com/jqlang/jq --full-local --use-ollama -o ./wiki-jq-ollama
```

---

## Comparing Results

To compare local mode quality with cloud mode:

```bash
# Generate with local mode
semanticwiki generate -r https://github.com/httpie/cli --full-local -o ./wiki-local

# Generate with Claude (requires API key)
semanticwiki generate -r https://github.com/httpie/cli --direct-api -o ./wiki-cloud

# Compare the outputs
diff -r ./wiki-local ./wiki-cloud
```

---

## Troubleshooting

### Model Download Issues
```bash
# Manual download if auto-download fails
mkdir -p ~/.semanticwiki/models
wget -O ~/.semanticwiki/models/qwen2.5-coder-14b-instruct-q5_k_m.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q5_k_m.gguf"
```

### Out of Memory
```bash
# Reduce context size
semanticwiki generate -r <repo> --full-local --context-size 16384

# Use smaller model
semanticwiki generate -r <repo> --full-local --local-model qwen2.5-coder-7b-q5

# Limit chunks for large repos
semanticwiki generate -r <repo> --full-local --max-chunks 2000
```

### Slow Performance
```bash
# Check GPU is being used
semanticwiki generate -r <repo> --full-local --verbose

# Force more GPU layers
semanticwiki generate -r <repo> --full-local --gpu-layers 40
```
