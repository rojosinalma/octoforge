import { MarkGithubIcon } from '@primer/octicons-react';
import { Link } from '@primer/react';
import { useApp } from '../hooks/useApp';

const REPO_URL = 'https://github.com/rojosinalma/octoforge';

export function Footer() {
  const { capabilities } = useApp();
  return (
    <footer className="app-footer fg-muted">
      <Link href={REPO_URL} target="_blank" rel="noreferrer" muted className="app-footer-link">
        <MarkGithubIcon size={14} aria-hidden /> Octoforge{capabilities ? ` v${capabilities.version}` : ''}
      </Link>
      <span aria-hidden>·</span>
      <Link href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" muted>
        Issues
      </Link>
      <span aria-hidden>·</span>
      <Link href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" muted>
        AGPL-3.0
      </Link>
    </footer>
  );
}
