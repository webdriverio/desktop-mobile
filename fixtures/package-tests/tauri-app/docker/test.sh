#!/bin/bash

# Script to test Docker builds locally for debugging
# Usage: ./test.sh [distro] [mode]
# Example: ./test.sh void
# Example: ./test.sh all
# Example: ./test.sh void build
# Example: ./test.sh void test
# Example: ./test.sh void debug
#
# The TARBALLS_DIR env variable must point to a directory containing pre-packed
# workspace tarballs (wdio-tauri-service-*.tgz etc.).  In CI this is set by the
# workflow after the runner-side "Pack tarballs" step.  Locally you can create
# the tarballs first:
#
#   cd <repo-root>
#   mkdir -p dist/tarballs
#   for pkg in tauri-service tauri-plugin native-core native-spy native-types native-utils; do
#     pnpm pack -C packages/$pkg --pack-destination "$(pwd)/dist/tarballs"
#   done
#   TARBALLS_DIR="$(pwd)/dist/tarballs" fixtures/package-tests/tauri-app/docker/test.sh all test

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# Validate that TARBALLS_DIR is set and non-empty before running tests
if [ -z "${TARBALLS_DIR:-}" ]; then
    echo "ERROR: TARBALLS_DIR is not set."
    echo "Pack tarballs first:"
    echo "  cd $REPO_ROOT"
    echo "  mkdir -p dist/tarballs"
    echo "  for pkg in tauri-service tauri-plugin native-core native-spy native-types native-utils; do"
    echo "    pnpm pack -C packages/\$pkg --pack-destination \"\$(pwd)/dist/tarballs\""
    echo "  done"
    echo "  TARBALLS_DIR=\"\$(pwd)/dist/tarballs\" $0 \$@"
    exit 1
fi

if [ ! -d "$TARBALLS_DIR" ]; then
    echo "ERROR: TARBALLS_DIR '$TARBALLS_DIR' does not exist or is not a directory."
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test a single dockerfile
test_dockerfile() {
    local distro=$1
    local dockerfile=$2

    echo -e "${YELLOW}=== Testing $distro ===${NC}"

    # Try to build the Docker image
    if docker build \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --progress=plain \
        -f "$SCRIPT_DIR/$dockerfile" \
        -t "tauri-distro-test:$distro" \
        "$REPO_ROOT" 2>&1 | tee "/tmp/docker-build-$distro.log"; then
        echo -e "${GREEN}✓ Build succeeded for $distro${NC}"
        return 0
    else
        echo -e "${RED}✗ Build failed for $distro${NC}"
        echo -e "${RED}  Log saved to: /tmp/docker-build-$distro.log${NC}"
        return 1
    fi
}

# Function to run tests in a built container
run_tests_in_container() {
    local distro=$1

    # Create a directory on the host to capture logs
    local log_dir="/tmp/tauri-test-logs-$distro"
    rm -rf "$log_dir"
    mkdir -p "$log_dir"

    echo -e "${YELLOW}=== Running tests for $distro ===${NC}"

    # The in-container logic lives in container-test.sh (reached through the
    # workspace bind mount) instead of an inline `bash -c` string -- an
    # unescaped double quote in an inline script truncates it silently and
    # the run reports a green no-op. See the header of container-test.sh.
    docker run --rm \
        -u root \
        -v "$REPO_ROOT:/workspace" \
        -v "$log_dir:/workspace/logs-output" \
        -v "$TARBALLS_DIR:/tarballs:ro" \
        -w /workspace \
        "tauri-distro-test:$distro" \
        bash /workspace/fixtures/package-tests/tauri-app/docker/container-test.sh \
        2>&1 | tee "/tmp/docker-test-$distro.log"

    # Check the exit code of docker run (PIPESTATUS[0]), not tee (PIPESTATUS[1])
    local docker_exit_code=${PIPESTATUS[0]}

    # Copy logs from mounted volume to repo for upload
    if [ -d "$log_dir" ]; then
        cp -r "$log_dir"/* "$REPO_ROOT/fixtures/package-tests/tauri-app/" 2>/dev/null || true
        echo "Logs copied to fixtures/package-tests/tauri-app/"
    fi

    if [ $docker_exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Tests passed for $distro${NC}"
        return 0
    else
        echo -e "${RED}✗ Tests failed for $distro${NC}"
        echo -e "${RED}  Log saved to: /tmp/docker-test-$distro.log${NC}"
        return 1
    fi
}

# Function to debug a failing dockerfile
debug_dockerfile() {
    local distro=$1
    local dockerfile=$2

    echo -e "${YELLOW}=== Debugging $distro ===${NC}"
    echo "Building with verbose output and stopping at first error..."

    docker build \
        --progress=plain \
        --no-cache \
        -f "$SCRIPT_DIR/$dockerfile" \
        -t "tauri-distro-test:$distro-debug" \
        "$REPO_ROOT" || {
            echo -e "${RED}Build failed. You can try building layer by layer to identify the issue.${NC}"
            echo "Tip: Comment out RUN commands in the Dockerfile one by one to find the failing step."
        }
}

# Main script
DISTRO="${1:-all}"
MODE="${2:-build}"  # build, test, or debug

case "$MODE" in
    build)
        echo "Building Docker images..."
        ;;
    test)
        echo "Building and testing Docker images..."
        ;;
    debug)
        echo "Debugging Docker builds..."
        ;;
    *)
        echo "Unknown mode: $MODE"
        echo "Usage: $0 [distro] [build|test|debug]"
        exit 1
        ;;
esac

# Function to get test case data
get_test_case() {
    case "$1" in
        ubuntu)
            echo "ubuntu ubuntu.dockerfile"
            ;;
        fedora)
            echo "fedora fedora.dockerfile"
            ;;
        debian)
            echo "debian debian.dockerfile"
            ;;
        arch)
            echo "arch arch.dockerfile"
            ;;
        void)
            echo "void void.dockerfile"
            ;;
        *)
            echo ""
            ;;
    esac
}

# Get all available test keys
get_all_test_keys() {
    echo "ubuntu fedora debian arch void"
}

# Filter test cases based on distro argument
if [ "$DISTRO" = "all" ]; then
    selected_tests=$(get_all_test_keys)
else
    selected_tests=""
    for key in $(get_all_test_keys); do
        case "$key" in
            $DISTRO*)
                selected_tests="$selected_tests $key"
                ;;
        esac
    done

    if [ -z "$selected_tests" ]; then
        echo -e "${RED}No tests found for distro: $DISTRO${NC}"
        echo "Available distros: ubuntu, fedora, debian, arch, void"
        exit 1
    fi
fi

# Track results
total=0
passed=0
failed=0

# Run tests
for test_key in $selected_tests; do
    test_data=$(get_test_case "$test_key")

    if [ -z "$test_data" ]; then
        echo -e "${RED}Unknown test case: $test_key${NC}"
        continue
    fi

    IFS=' ' read -r distro dockerfile <<< "$test_data"

    total=$((total + 1))

    case "$MODE" in
        build)
            if test_dockerfile "$distro" "$dockerfile"; then
                passed=$((passed + 1))
            else
                failed=$((failed + 1))
            fi
            ;;
        test)
            if test_dockerfile "$distro" "$dockerfile"; then
                if run_tests_in_container "$distro"; then
                    passed=$((passed + 1))
                else
                    failed=$((failed + 1))
                fi
            else
                failed=$((failed + 1))
            fi
            ;;
        debug)
            debug_dockerfile "$distro" "$dockerfile"
            ;;
    esac

    echo ""
done

# Print summary
if [ "$MODE" != "debug" ]; then
    echo -e "${YELLOW}=== Summary ===${NC}"
    echo -e "Total: $total"
    echo -e "${GREEN}Passed: $passed${NC}"
    echo -e "${RED}Failed: $failed${NC}"

    if [ $failed -gt 0 ]; then
        echo -e "\n${RED}Some tests failed. Check logs in /tmp/docker-*.log${NC}"
        exit 1
    else
        echo -e "\n${GREEN}All tests passed!${NC}"
    fi
fi
