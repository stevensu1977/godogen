import type { RunStatus } from '@godogen/shared';
import { STATUS_LABEL } from '../lib/format';

export function StatusPill({ status }: { status: RunStatus }) {
  return <span className={`pill ${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>;
}
