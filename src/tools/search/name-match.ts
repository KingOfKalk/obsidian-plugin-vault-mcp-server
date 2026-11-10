/**
 * Name matching for `search_by_name` (#491).
 *
 * A query with `*` or `?` is a glob; anything else is a substring of the
 * vault-relative path. Both ignore case. A glob without `/` is matched
 * against the file name, a glob with `/` against the whole path:
 * `*` matches within one path segment, `**` across segments (`**`/ also
 * matches no folder at all) and `?` one character other than `/`.
 */
export function createNameMatcher(query: string): (path: string) => boolean {
  const lowerQuery = query.toLowerCase();
  if (!/[*?]/.test(query)) {
    return (path) => path.toLowerCase().includes(lowerQuery);
  }
  const regex = globToRegExp(query);
  if (query.includes('/')) {
    return (path) => regex.test(path);
  }
  return (path) => regex.test(path.slice(path.lastIndexOf('/') + 1));
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\/-]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'i');
}
