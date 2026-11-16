import path from 'path';
import jestOpenAPI from 'jest-openapi';

const openApiPath = path.join(__dirname, '../docs/api/openapi.yaml');
jestOpenAPI(openApiPath);
