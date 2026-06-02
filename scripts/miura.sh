#!/bin/bash
# MiuraSwarm launcher for bash/Git Bash
# Add to ~/.bashrc: source /c/Users/carja/miuraswarm/scripts/miura.sh
# Or: source /c/Users/carja/miuraswarm/scripts/miura.sh  (from any directory)

miura() {
	cd /c/Users/carja/miuraswarm && bun start "$@"
}
