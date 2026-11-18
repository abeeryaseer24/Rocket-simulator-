import { useEffect } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { LESSONS } from '../academy/lessons';
import './academy.css';

export default function Academy() {
  const { lesson } = useParams();
  const idx = LESSONS.findIndex((l) => l.id === lesson);
  const l = idx >= 0 ? LESSONS[idx] : null;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [lesson]);

  return (
    <div className="ac">
      <nav className="ac-nav" aria-label="Lessons">
        <Link to="/academy" className="ac-home">
          Academy
        </Link>
        <ol>
          {LESSONS.map((x) => (
            <li key={x.id}>
              <NavLink to={`/academy/${x.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
                {x.title}
              </NavLink>
            </li>
          ))}
        </ol>
      </nav>
      <main className="ac-main">
        {!l ? (
          <div className="ac-index">
            <h1>Rocket science, one idea at a time</h1>
            <p className="lede">
              Eleven short lessons, in order. Each one derives an equation, lets you play with it, and points to the place in the
              simulator where you can watch it act on a real flight.
            </p>
            <ol className="ac-list">
              {LESSONS.map((x) => (
                <li key={x.id}>
                  <Link to={`/academy/${x.id}`}>
                    <span className="ac-disc">{x.discipline}</span>
                    <strong>{x.title}</strong>
                    <span className="ac-sum">{x.summary}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <article className="ac-lesson">
            <p className="ac-disc">
              Lesson {idx + 1} of {LESSONS.length}, {l.discipline.toLowerCase()}
            </p>
            <h1>{l.title}</h1>
            <p className="ac-summary">{l.summary}</p>
            <div className="ac-body">{l.body()}</div>
            <nav className="ac-pager" aria-label="Lesson navigation">
              {idx > 0 ? (
                <Link to={`/academy/${LESSONS[idx - 1].id}`}>
                  <span>Previous</span>
                  {LESSONS[idx - 1].title}
                </Link>
              ) : (
                <span />
              )}
              {idx < LESSONS.length - 1 && (
                <Link to={`/academy/${LESSONS[idx + 1].id}`} className="next">
                  <span>Next</span>
                  {LESSONS[idx + 1].title}
                </Link>
              )}
            </nav>
          </article>
        )}
      </main>
    </div>
  );
}
