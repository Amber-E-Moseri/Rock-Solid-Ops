import { useState } from 'react';
import {
  Button, Badge, Table, Modal, Drawer, Skeleton, Card,
  KpiGrid, Kpi, PageHeader, Toolbar, SearchInput, Select, EmptyState,
} from '../../components/ui/index.js';
import { Users } from 'lucide-react';

const SAMPLE_DATA = [
  { id: 1, name: 'Sarah Johnson', email: 'sarah@test.com', status: 'ASSIGNED', campus: 'North' },
  { id: 2, name: 'Michael Chen', email: 'michael@test.com', status: 'PENDING', campus: 'South' },
  { id: 3, name: 'Emma Wilson', email: 'emma@test.com', status: 'WAITLISTED', campus: 'East' },
  { id: 4, name: 'James Brown', email: 'james@test.com', status: 'DUPLICATE', campus: 'West' },
  { id: 5, name: 'Ana Garcia', email: 'ana@test.com', status: 'COMPLETED', campus: 'North' },
];

const COLUMNS = [
  { key: 'name', label: 'Name', sticky: true },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Status', render: (val) => <Badge status={val} /> },
  { key: 'campus', label: 'Campus' },
];

export default function ShowcasePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Design System Showcase"
        subtitle="All core components in one view"
        actions={
          <>
            <Button variant="secondary">Secondary</Button>
            <Button variant="primary">+ Create</Button>
          </>
        }
      />

      {/* KPIs */}
      <KpiGrid>
        <Kpi value="142" label="Total Students" />
        <Kpi value="89" label="Assigned" />
        <Kpi value="23" label="Pending" />
        <Kpi value="30" label="Waitlisted" />
      </KpiGrid>

      {/* Badges */}
      <Card title="Badges" icon={<Users size={20} />} subtitle="Status and semantic variants">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <Badge status="PENDING" />
          <Badge status="ASSIGNED" />
          <Badge status="WAITLISTED" />
          <Badge status="DUPLICATE" />
          <Badge status="REVIEW" />
          <Badge status="INACTIVE" />
          <Badge status="COMPLETED" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <Badge status="DRAFT" />
          <Badge status="ACTIVE" />
          <Badge status="UPCOMING" />
          <Badge status="ARCHIVED" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge variant="success">Success</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </div>
      </Card>

      {/* Buttons */}
      <Card title="Buttons" subtitle="Variants and sizes">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="success">Success</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="md">Medium</Button>
          <Button variant="primary" size="lg">Large</Button>
        </div>
      </Card>

      {/* Toolbar */}
      <Toolbar>
        <SearchInput placeholder="Search students..." />
        <Select style={{ width: 'auto' }}>
          <option>All statuses</option>
          <option>PENDING</option>
          <option>ASSIGNED</option>
        </Select>
        <Button variant="primary" size="sm">Apply</Button>
      </Toolbar>

      {/* Table */}
      <Table
        columns={COLUMNS}
        data={SAMPLE_DATA}
        defaultSort="name"
        onRowClick={(row) => setDrawerOpen(true)}
      />

      {/* Skeleton */}
      <Card title="Skeleton" subtitle="Loading states" style={{ marginTop: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Text</p>
            <Skeleton variant="text" count={3} />
          </div>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Rows</p>
            <Skeleton variant="row" count={3} />
          </div>
        </div>
      </Card>

      {/* Modal / Drawer triggers */}
      <Card title="Overlays" subtitle="Modal and Drawer" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Edit Student"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Save</Button>
          </>
        }
      >
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          This is a modal with the warm-parchment design tokens, Framer Motion entrance, and Escape key dismiss.
        </p>
      </Modal>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Student Profile"
      >
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          This is a slide-in drawer with spring animation, backdrop, and Escape dismiss.
        </p>
      </Drawer>
    </div>
  );
}
