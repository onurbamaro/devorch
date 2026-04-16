# Code Conventions

**Analyzed**: 2 files

## Naming

- **Variables & constants**: camelCase (camel: 31, snake: 0)
- **Types/Classes**: PascalCase (1 found)

## Exports & Imports

- **Exports**: named preferred (named: 0, default: 0)
- **Imports**: named={4} default={0} star={0}

## Style

- **Semicolons**: yes (63 with, 26 without)
- **Quotes**: double (single: 0, double: 29)
- **Functions**: regular preferred (arrow: 1, regular: 3)
- **Async/await**: 2 occurrences
- **Indentation**: 2 spaces

## Error Handling

- try/catch blocks: 5
- Silent catch (swallow errors): 1
- process.exit() calls: 6
- **Pattern**: Silent fallback (errors caught and swallowed)

## Patterns

**Import clusters** (most frequent):
- `fs`: 2 imports
- `path`: 2 imports

**Function signatures** (from AST):
- `findRoot(start: string): string | null` (`hooks/post-edit-lint.ts`)
- `detect(): LintCmd | null` (`hooks/post-edit-lint.ts`)

Async/sync ratio: 0 async, 2 sync


## Testing

- No tests detected
- Test framework: **unknown**
