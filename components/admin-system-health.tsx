"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminPipelineStage, AdminServicePipeline } from "@/lib/admin-operations";
import styles from "./admin-system-health.module.css";

type HealthStatus = "green" | "amber" | "red";

type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  message: string;
};

type HealthResponse = {
  checks: HealthCheck[];
  checkedAt: string;
};

type PipelineResponse = {
  pipeline: AdminServicePipeline;
  checkedAt: string;
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  green: "Healthy",
  amber: "Degraded",
  red: "Failing",
};

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Polls /api/admin/health, which runs each check independently server-side.
 * A malformed or partial response still renders whatever checks came back.
 */
export function AdminSystemHealth() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Record<string, AdminServicePipeline>>({});
  const [pipelineLoading, setPipelineLoading] = useState<Record<string, boolean>>({});
  const [pipelineErrors, setPipelineErrors] = useState<Record<string, string | null>>({});
  const [selectedStage, setSelectedStage] = useState<Record<string, string | null>>({});

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/health", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          payload.error || "The system health check could not be loaded.",
        );
      }
      const payload = (await response.json()) as HealthResponse;
      setChecks(Array.isArray(payload.checks) ? payload.checks : []);
      setCheckedAt(payload.checkedAt || null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The system health check could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPipeline = useCallback(async (serviceId: string) => {
    setPipelineLoading((prev) => ({ ...prev, [serviceId]: true }));
    setPipelineErrors((prev) => ({ ...prev, [serviceId]: null }));
    try {
      const response = await fetch(
        `/api/admin/health/pipeline?service=${encodeURIComponent(serviceId)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          payload.error || "This pipeline detail could not be loaded.",
        );
      }
      const payload = (await response.json()) as PipelineResponse;
      setPipelines((prev) => ({ ...prev, [serviceId]: payload.pipeline }));
    } catch (err) {
      setPipelineErrors((prev) => ({
        ...prev,
        [serviceId]:
          err instanceof Error
            ? err.message
            : "This pipeline detail could not be loaded.",
      }));
    } finally {
      setPipelineLoading((prev) => ({ ...prev, [serviceId]: false }));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadHealth());
    const interval = setInterval(() => void loadHealth(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadHealth]);

  const toggleExpanded = (serviceId: string) => {
    const next = expandedId === serviceId ? null : serviceId;
    setExpandedId(next);
    if (next) void loadPipeline(next);
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>System Health</h2>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => void loadHealth()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {checkedAt ? (
        <p className={styles.timestamp}>
          Checked {new Date(checkedAt).toLocaleTimeString()}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && checks.length === 0 && !error ? (
        <p className={styles.loading}>Checking system health…</p>
      ) : null}

      <ul className={styles.grid}>
        {checks.map((check) => {
          const expanded = expandedId === check.id;
          return (
            <li key={check.id} className={styles.card} data-status={check.status}>
              <button
                type="button"
                className={styles.cardToggle}
                onClick={() => toggleExpanded(check.id)}
                aria-expanded={expanded}
              >
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.cardBody}>
                  <span className={styles.cardLabel}>{check.label}</span>
                  <span className={styles.cardStatus}>{STATUS_LABEL[check.status]}</span>
                  <span className={styles.cardMessage}>{check.message}</span>
                </span>
                <span className={styles.cardChevron} aria-hidden="true">
                  {expanded ? "▲" : "▼"}
                </span>
              </button>

              {expanded ? (
                <div className={styles.drillDown}>
                  {pipelineLoading[check.id] && !pipelines[check.id] ? (
                    <p className={styles.loading}>Loading pipeline…</p>
                  ) : null}
                  {pipelineErrors[check.id] ? (
                    <p className={styles.error} role="alert">
                      {pipelineErrors[check.id]}
                    </p>
                  ) : null}
                  {pipelines[check.id] ? (
                    <PipelineFlow
                      pipeline={pipelines[check.id]}
                      selectedStageId={selectedStage[check.id] || null}
                      onSelectStage={(stageId) =>
                        setSelectedStage((prev) => ({
                          ...prev,
                          [check.id]: prev[check.id] === stageId ? null : stageId,
                        }))
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.pipelineRefreshButton}
                    onClick={() => void loadPipeline(check.id)}
                    disabled={pipelineLoading[check.id]}
                  >
                    Refresh pipeline
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STAGE_STATUS_LABEL: Record<HealthStatus, string> = {
  green: "OK",
  amber: "Watch",
  red: "Failing",
};

function PipelineFlow({
  pipeline,
  selectedStageId,
  onSelectStage,
}: {
  pipeline: AdminServicePipeline;
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}) {
  const selectedStage: AdminPipelineStage | undefined = pipeline.stages.find(
    (stage) => stage.id === selectedStageId,
  );

  return (
    <div className={styles.pipeline}>
      <ol className={styles.pipelineFlow}>
        {pipeline.stages.map((stage, index) => (
          <li key={stage.id} className={styles.pipelineNodeWrap}>
            {index > 0 ? <span className={styles.connector} aria-hidden="true" /> : null}
            <button
              type="button"
              className={styles.pipelineNode}
              data-status={stage.status}
              data-selected={selectedStageId === stage.id}
              onClick={() => onSelectStage(stage.id)}
              aria-expanded={selectedStageId === stage.id}
            >
              <span className={styles.pipelineNodeDot} aria-hidden="true" />
              <span className={styles.pipelineNodeLabel}>{stage.label}</span>
              <span className={styles.pipelineNodeStatus}>{STAGE_STATUS_LABEL[stage.status]}</span>
            </button>
          </li>
        ))}
      </ol>

      {selectedStage ? (
        <div className={styles.pipelineDetail} data-status={selectedStage.status}>
          <p className={styles.pipelineDetailLabel}>{selectedStage.label}</p>
          <p className={styles.pipelineDetailMessage}>{selectedStage.message}</p>
          <p className={styles.pipelineDetailObserved}>
            {selectedStage.observedAt
              ? `Last observed ${new Date(selectedStage.observedAt).toLocaleString()}.`
              : "Checked live just now."}
          </p>
        </div>
      ) : (
        <p className={styles.pipelineHint}>Tap a stage above to see its detail.</p>
      )}
    </div>
  );
}
