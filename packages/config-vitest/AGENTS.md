# AGENTS.md

## 1. Overview
`packages/config-vitest` provides the shared Vitest coverage configuration for the monorepo.

## 2. Folder Structure
- The shared coverage config each workspace extends.

## 3. Core Behaviors & Patterns
This package owns the coverage **provider, reporters, and exclusions**. It does **not** own thresholds — each workspace supplies its own.

That split is deliberate and load-bearing: thresholds are a property of how well a given workspace is tested, so centralizing them would either hold every package to the weakest one or break the weakest package on every change here.

## 4. Conventions
A new workspace extends this config and declares its own thresholds. Do not add a threshold block here to "set a default" — that is the same mistake in a different place.

## 5. Working Agreements
Deleting a large chunk of code *and* its tests moves a workspace's coverage ratio and can move it into a failing gate. Re-check the affected workspace's thresholds after any such removal — the gate is workspace-owned, so nothing here will warn you.
