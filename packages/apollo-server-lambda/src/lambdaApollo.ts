import lambda from 'aws-lambda';
import {
  GraphQLOptions,
  HttpQueryError,
  runHttpQuery,
  FileUploadOptions,
} from 'apollo-server-core';
import { Headers } from 'apollo-server-env';
import { processRequest as processFileUploads } from '@apollographql/apollo-upload-server';
import stream from 'stream';

export interface LambdaGraphQLOptionsFunction {
  (event: lambda.APIGatewayProxyEvent, context: lambda.Context):
    | GraphQLOptions
    | Promise<GraphQLOptions>;
}

const fileUploadProcess = async (
  event: any,
  uploadsConfig?: FileUploadOptions,
) => {
  if (event.body && event.body.startsWith('------')) {
    const request = new stream.Readable() as any;
    request.push(event.body);
    request.push(null);
    request.headers = event.headers;
    request.headers['content-type'] =
      event.headers['content-type'] || event.headers['Content-Type'];

    console.log('request', request);
    const result = await processFileUploads(request, uploadsConfig || {});
    console.log('result', result);
    return result;
  }

  return event.body;
};

export function graphqlLambda(
  options: GraphQLOptions | LambdaGraphQLOptionsFunction,
  uploadsConfig?: FileUploadOptions,
): lambda.APIGatewayProxyHandler {
  if (!options) {
    throw new Error('Apollo Server requires options.');
  }

  if (arguments.length > 2) {
    throw new Error(
      `Apollo Server expects one or two argument, got ${arguments.length}`,
    );
  }

  const graphqlHandler: lambda.APIGatewayProxyHandler = (
    event,
    context,
    callback,
  ): void => {
    context.callbackWaitsForEmptyEventLoop = false;

    if (event.httpMethod === 'POST' && !event.body) {
      return callback(null, {
        body: 'POST body missing.',
        statusCode: 500,
      });
    }

    fileUploadProcess(event, uploadsConfig)
      .then((body: any) => {
        event.body = body;

        let query: any = event.queryStringParameters;
        if (event.httpMethod === 'POST' && event.body) {
          if (typeof event.body === 'string') {
            query = JSON.parse(event.body);
          } else {
            query = event.body;
          }
        }

        return runHttpQuery([event, context], {
          method: event.httpMethod,
          options: options,
          query,
          request: {
            url: event.path,
            method: event.httpMethod,
            headers: new Headers(event.headers),
          },
        });
      })
      .then(
        ({ graphqlResponse, responseInit }) => {
          callback(null, {
            body: graphqlResponse,
            statusCode: 200,
            headers: responseInit.headers,
          });
        },
        (error: HttpQueryError) => {
          if ('HttpQueryError' !== error.name) return callback(error);
          callback(null, {
            body: error.message,
            statusCode: error.statusCode,
            headers: error.headers,
          });
        },
      );
  };

  return graphqlHandler;
}
