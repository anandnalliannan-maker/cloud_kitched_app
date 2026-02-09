import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class AreaService {
  AreaService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get _areasRef =>
      _firestore.collection('service_areas');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchAreas() {
    return _areasRef.orderBy('name').snapshots();
  }

  Future<void> addArea(String name) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('User not signed in');
    }

    await _areasRef.add({
      'name': name,
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': user.uid,
    });
  }

  Future<void> updateArea(String id, String name) {
    return _areasRef.doc(id).update({
      'name': name,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteArea(String id) {
    return _areasRef.doc(id).delete();
  }
}
