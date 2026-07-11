import { createJobApp } from '@constructive-io/knative-job-fn';
import { getKnativeJobExamplePort } from '@constructive-io/graphql-env';

const app = createJobApp();

app.post('/', async (req: any, res: any, next: any) => {
  if (req.body.throw) {
    next(new Error('THROWN_ERROR'));
  } else {
    res.status(200).json({
      fn: 'example-fn',
      message: 'hi I did a lot of work',
      body: req.body
    });
  }
});

const port = getKnativeJobExamplePort();
app.listen(port);
