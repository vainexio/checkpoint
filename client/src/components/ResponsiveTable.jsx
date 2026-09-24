import { Fragment } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * One description of a table, drawn two ways.
 *
 * A seven-column operations table is the right shape on a desk and the wrong
 * shape on a phone: at 390px the columns collapsed onto each other until a
 * route name wrapped over three lines and the last two columns — where the bus
 * actually was, and when it is due — were clipped off the right-hand edge
 * entirely. Sideways scrolling inside a card is not a fix; nothing on screen
 * says the columns are there.
 *
 * So below the large breakpoint the same rows are drawn as cards: the column
 * marked `lead` becomes the headline, the rest become labelled pairs, and
 * nothing is cut off. Above it, the table comes back exactly as it was.
 *
 * Large, not medium: at 768px these seven columns technically fit, in the
 * sense that every route name wrapped onto two lines and every status badge
 * onto three. A table is only worth having at a width where its rows are one
 * line tall.
 *
 * Both come from one array of columns so the two can never drift apart — the
 * usual failure of hand-maintaining a "mobile version" of a table.
 *
 * @param columns  [{ key, header, cell(row), className, headClassName,
 *                    lead, wide, hideOnCard }]
 *                 `lead`      the headline on a card (exactly one)
 *                 `aside`     sits beside the headline, right-aligned — for
 *                             the one figure that belongs next to the name
 *                             rather than in the grid under it
 *                 `wide`      give this pair the full width of the card
 *                 `bare`      no label — for a row of controls, which an
 *                             "ACTIONS" caption above it only makes harder to
 *                             read. Combine with `wide` for a full-width row.
 *                 `hideOnCard` drop it from the card only
 * @param expanded  optional (row) => node — an editor or detail panel opened
 *                  from the row itself. It spans the table on a desk and sits
 *                  inside the card on a phone, so a row only ever has one
 *                  place to open into.
 * @param empty    what to draw when there are no rows at all
 */
export function ResponsiveTable({
  columns,
  rows,
  rowKey,
  rowClassName,
  cardClassName,
  expanded = null,
  empty = null,
  className,
}) {
  if (!rows.length) return empty;

  const lead = columns.find((c) => c.lead) ?? columns[0];
  const aside = columns.find((c) => c.aside);
  const rest = columns.filter((c) => c !== lead && c !== aside && !c.hideOnCard);

  return (
    <>
      {/* ------------------------------------------------------ phone: cards */}
      <div className={cn('space-y-2.5 lg:hidden', className)}>
        {rows.map((row) => {
          const key = rowKey(row);
          const panel = expanded?.(row);
          return (
            <div
              key={key}
              className={cn(
                'rounded-xl border border-border bg-card p-3.5',
                cardClassName?.(row),
                rowClassName?.(row)
              )}
            >
              <div className="mb-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">{lead.cell(row)}</div>
                {aside && (
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {aside.header}
                    </div>
                    <div className="mt-0.5 text-[13px]">{aside.cell(row)}</div>
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {rest.map((col) => (
                  <Fragment key={col.key}>
                    <div className={cn('min-w-0', col.wide && 'col-span-2')}>
                      {!col.bare && (
                        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          {col.header}
                        </dt>
                      )}
                      <dd className={cn('text-[13px]', !col.bare && 'mt-0.5')}>{col.cell(row)}</dd>
                    </div>
                  </Fragment>
                ))}
              </dl>
              {panel && (
                <div className="mt-3 border-t border-dashed border-border pt-3">{panel}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ----------------------------------------------------- desk: a table */}
      <div className={cn('hidden lg:block', className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headClassName}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const panel = expanded?.(row);
              return (
                <Fragment key={rowKey(row)}>
                  <TableRow className={cn(rowClassName?.(row))}>
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {panel && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="bg-muted/40">
                        {panel}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
