export function writeCliError(stage, error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage,
        error: error instanceof Error ? error.message : `${stage} failed`
      },
      null,
      2
    )
  );
}
