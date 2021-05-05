# circle-ci-artifact-downloader

This is an utility script to download all the CircleCI artifacts that were produced in the account. Use the following commands to run the script

The scripts expects the following environment variables to be set for it to work
```
CIRCLE_CI_TOKEN=<your token>
```

```bash
yarn
yarn start
```

The files gets downloaded to `downloads` folder.