import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminReviewPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/staff/applicant-directory?tab=review', { replace: true });
  }, [navigate]);
  return null;
}
