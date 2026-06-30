async function preUndeploy(): Promise<void> {
  console.log('preUndeploy: nothing to do yet');
}

preUndeploy()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('preUndeploy failed:', err);
    process.exit(1);
  });