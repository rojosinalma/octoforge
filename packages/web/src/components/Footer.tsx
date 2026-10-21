import { Ui } from 'tailor-react';
import { useApp } from '../hooks/useApp';

const REPO_URL = 'https://github.com/rojosinalma/octoforge';

/** Repository links on the left; the sun/moon toggle first in the end slot, then the version. */
export function Footer() {
  const { capabilities } = useApp();
  return (
    <Ui.Footer className="t-shell-foot app-footer">
      <Ui.Footer.Repo href={REPO_URL} target="_blank" rel="noreferrer" label="Repository">
        <Ui.Icon name="bi-github" />
      </Ui.Footer.Repo>
      <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="t-muted">
        Issues
      </a>
      <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="t-muted">
        AGPL-3.0
      </a>
      <Ui.Footer.End>
        <Ui.Footer.Pickers parts={['mode']} />
        <Ui.Footer.Version>Octoforge{capabilities ? ` v${capabilities.version}` : ''}</Ui.Footer.Version>
      </Ui.Footer.End>
    </Ui.Footer>
  );
}
