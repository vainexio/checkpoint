import { Link, NavLink } from 'react-router-dom';
import { formatTime } from '../utils/time.js';

export function Wordmark({ to = '/' }) {
  return (
    <Link to={to} className="wordmark">
      <span className="wordmark__mark" aria-hidden="true" />
      CHECKPOINT
    </Link>
  );
}

export function Masthead({ links = [], right = null, home = '/' }) {
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <Wordmark to={home} />
        <nav className="masthead__nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}
          {right}
        </nav>
      </div>
    </header>
  );
}

/**
 * Updates arrive when a conductor taps, not on a ticker — but a board that
 * never visibly moves reads as broken. This says plainly when the screen last
 * checked, which is the truthful version of "live".
 */
export function LiveIndicator({ lastUpdated }) {
  return (
    <span className="pulse">
      <span className="pulse__dot" aria-hidden="true" />
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
