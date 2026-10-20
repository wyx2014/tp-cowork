import { readFile } from 'node:fs/promises';

/** Inject TP Cowork's initial appearance before the Client theme mounts. */
export async function apply(ctx) {
  const styles = await Promise.all(['styles.css', 'upstream.css'].map(path =>
    readFile(new URL(path, import.meta.url), 'utf8')));
  const css = styles.join('\n');
  ctx.on('webserver/index-inject', table => {
    table.push(
      { kind: 'style', text: css },
      { kind: 'script', placement: 'body', text: "document.body.setAttribute('data-tpcowork-ui', '')" },
    );
  });
}
