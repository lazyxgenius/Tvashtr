/** Import tests from a CSV: a dry run on choosing the file, then all or nothing. */
import { useRef, useState } from "react";

import { Button } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type ImportResult, type ModelDetail, importTests } from "../../lib/api/models";
import { ModelDialog } from "./ModelDialog";
import { plural } from "./modelsFormat";

export function ImportCsvDialog({
  model,
  onClose,
  onImported,
}: {
  model: ModelDetail;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = model.model_id;

  const words = (err: unknown) =>
    err instanceof ApiError ? err.message : "Couldn’t read that file. Try again.";

  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const text = await chosen.text();
      setFile({ name: chosen.name, text });
      setPreview(await importTests(id, { filename: chosen.name, csv: text, dry_run: true }));
    } catch (err) {
      setError(words(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const out = await importTests(id, { filename: file.name, csv: file.text, dry_run: false });
      if (out.imported) {
        onImported();
        return;
      }
      setPreview(out);
    } catch (err) {
      setError(words(err));
    }
    setBusy(false);
  };

  const ready = preview !== null && preview.errors.length === 0;

  return (
    <ModelDialog
      title="Import tests from a CSV"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {ready && (
            <Button variant="primary" loading={busy} onClick={() => void run()}>
              Import {plural(preview.ready, "test")}
            </Button>
          )}
        </>
      }
    >
      <p className="md-body">
        The first row names the columns. You need input and expected. For Write text models you can
        add scoring (exact, contains or judge), must_contain (phrases split by ;), rubric and
        judge_model.
      </p>
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Choose a CSV file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          data-testid="model-csv-file"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {ready && (
        <p className="md-body" role="status">
          {plural(preview.ready, "test")} ready to import. They become test set v
          {preview.next_version}.
        </p>
      )}
      {preview && preview.errors.length > 0 && (
        <div className="md-csverrors" role="alert">
          <ul>
            {preview.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="md-body">Fix the file and choose it again. Nothing was imported.</p>
        </div>
      )}
      {error && (
        <span className="md-error" role="alert">
          {error}
        </span>
      )}
    </ModelDialog>
  );
}
