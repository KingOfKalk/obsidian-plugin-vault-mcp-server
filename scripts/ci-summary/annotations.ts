/**
 * GitHub Actions workflow commands for file annotations (#416).
 *
 * GitHub shows at most 10 annotations per type (error, warning, notice) per
 * step, so `renderAnnotations` emits the first 10 of each level and one
 * notice that points at the job summary for the rest.
 */
import { MAX_MESSAGE_LENGTH, truncate } from './markdown';

export type AnnotationLevel = 'error' | 'warning' | 'notice';

export interface Annotation {
  level: AnnotationLevel;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  endLine?: number;
  endColumn?: number;
  title?: string;
}

/** GitHub's per-step display limit for each annotation level. */
export const ANNOTATIONS_PER_LEVEL = 10;

function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function formatAnnotation(annotation: Annotation): string {
  const props: string[] = [];
  if (annotation.file !== undefined) props.push(`file=${escapeProperty(annotation.file)}`);
  if (annotation.line !== undefined) props.push(`line=${annotation.line}`);
  if (annotation.endLine !== undefined) props.push(`endLine=${annotation.endLine}`);
  if (annotation.col !== undefined) props.push(`col=${annotation.col}`);
  if (annotation.endColumn !== undefined) props.push(`endColumn=${annotation.endColumn}`);
  if (annotation.title !== undefined) props.push(`title=${escapeProperty(annotation.title)}`);
  const head =
    props.length > 0 ? `::${annotation.level} ${props.join(',')}` : `::${annotation.level}`;
  return `${head}::${escapeData(truncate(annotation.message, MAX_MESSAGE_LENGTH))}`;
}

/**
 * Workflow command lines for `annotations`, capped at `perLevel` per level.
 * When some are dropped, a final notice says how many and where to look.
 */
export function renderAnnotations(
  annotations: Annotation[],
  perLevel = ANNOTATIONS_PER_LEVEL,
): string[] {
  const counts: Record<AnnotationLevel, number> = { error: 0, warning: 0, notice: 0 };
  const lines: string[] = [];
  let dropped = 0;
  for (const annotation of annotations) {
    if (counts[annotation.level] < perLevel) {
      lines.push(formatAnnotation(annotation));
    } else {
      dropped++;
    }
    counts[annotation.level]++;
  }
  if (dropped > 0) {
    lines.push(
      formatAnnotation({
        level: 'notice',
        title: 'More findings',
        message: `${dropped} more finding(s) are not annotated (GitHub shows ${perLevel} per type per step). The job summary lists them.`,
      }),
    );
  }
  return lines;
}
