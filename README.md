## Setup
The Professional API is a AWS Lambda Service built using the serverless framework https://github.com/serverless/serverless. There is currently an issue with later versions of the serverless framework that improperly include dev dependencies bloating the size of the bundles and in some cases causing the bundle to exceed the AWS Lambda package size.

```bash
npm install -g serverless@2.28.0
```

## Debugging
The Professional API project's `.vscode\launch.json` is pre configured to execute the projects `npm run debug` and can be debugged with in Visual Studio Code by using `Run -> Start Debugging` menu. Postman can then be used to call the various API endpoints at the configured localhost address. `http://localhost:3000` (default). Sample endpoint calls can be found on the Team Drive `Team Drive\Platform 2.0 Documentation\Back End Architecture Modules\Postman`.

## Deployment
### Dev
```bash
serverless deploy
```
### Staging
```bash
serverless deploy --stage staging
```
### Production
```bash
serverless deploy --stage prod
```

