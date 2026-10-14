import { useNavigate } from 'react-router';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <s-page heading="Page not found">
      <s-section>
        <s-empty-state heading="This page does not exist">
          <s-paragraph slot="subheading">
            The rule may have been deleted, or the link is out of date.
          </s-paragraph>
          <s-button slot="primary-action" onClick={() => void navigate('/')}>
            Back to discount rules
          </s-button>
        </s-empty-state>
      </s-section>
    </s-page>
  );
}
