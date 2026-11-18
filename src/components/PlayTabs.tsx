import { NavLink } from 'react-router-dom';

/** The three ways to play, shown at the top of each Play page. */
export default function PlayTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <nav className="tabs play-tabs" aria-label="Play">
      <NavLink to="/missions" className={cls}>
        Challenges
      </NavLink>
      <NavLink to="/worlds" className={cls}>
        Other worlds
      </NavLink>
      <NavLink to="/history" className={cls}>
        Historic flights
      </NavLink>
    </nav>
  );
}
