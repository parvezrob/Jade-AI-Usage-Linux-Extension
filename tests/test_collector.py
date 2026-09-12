import importlib.util,pathlib,unittest,urllib.error,math
p=pathlib.Path(__file__).resolve().parents[1]/'scripts/collector.py'
spec=importlib.util.spec_from_file_location('collector',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class QuotaTests(unittest.TestCase):
 def test_spark_is_not_in_main_allowance(self):
  group={'primary':{'usedPercent':12,'windowDurationMins':10080,'resetsAt':None}}
  rows=m.codex_windows({'rateLimitsByLimitId':{'codex':group,'codex_bengalfox':group}})
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['label'],'Weekly')
 def test_remaining_not_used(self):self.assertEqual(m.window('Weekly',43,None)['remaining'],57)
 def test_missing_is_not_full(self):self.assertIsNone(m.window('Weekly',None,None))
 def test_invalid_numbers(self):
  for v in [True,'43',math.inf,math.nan]:self.assertIsNone(m.window('x',v,None))
 def test_bounds(self):
  self.assertEqual(m.window('x',130,None)['remaining'],0)
  self.assertEqual(m.window('x',-5,None)['remaining'],100)
 def test_iso_reset(self):self.assertEqual(m.window('x',0,'1970-01-01T01:00:00+01:00')['resetsAt'],0)
 def test_http_messages_no_token(self):
  e=urllib.error.HTTPError('https://example.invalid',401,'secret server text',{},None)
  self.assertEqual(m.error_text(e),'Sign in again');e.close()
if __name__=='__main__':unittest.main()
